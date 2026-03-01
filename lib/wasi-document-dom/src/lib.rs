use core::{error::Error, ops};
use std::borrow::Cow;

use html_and_tar::{ParsedFileData, EntryAttributes, TarDecompiler, TarHeader};
use lithtml::{Dom, Element, Node};

pub struct Structure {
    pub html_tag: TagSpan,
    pub html_insertion_point: usize,
    pub insertion_tag: TagSpan,
    pub stage0: TagSpan,
}

#[derive(Clone, Copy)]
pub struct TagSpan {
    pub start: SourceCharacter,
    pub end: SourceCharacter,
}

#[derive(Clone, Copy)]
pub struct SourceCharacter {
    pub line: usize,
    pub column: usize,
}

/// A Wasi Document file node extracted from HTML DOM.
///
/// Basically the data passed as the root FS in stage 1 but in Rust. Can be used to rebuild a file
/// into tar structure when it was mangled due to intermediate HTML transformations.
#[derive(Clone)]
pub struct TarFile {
    pub header: TarHeader,
    pub content: Vec<u8>,
}

impl TarFile {
    /// The user-defined attributes of this file entry.
    pub fn attributes(&self) -> EntryAttributes<'_> {
        EntryAttributes::from_header(&self.header)
    }
}

pub struct SourceDocument<'text> {
    text: Cow<'text, str>,
    by_line: Vec<usize>,
}

fn parse_tar_tags(source: &mut SourceDocument) -> Result<Structure, Box<dyn Error>> {
    const ID_TAR_CONTENT: &str = "WAH_POLYGLOT_HTML_PLUS_TAR_CONTENT";
    const ID_TAR_STAGE0: &str = "WAH_POLYGLOT_HTML_PLUS_TAR_STAGE0";

    let (mut dom, html, insertion, stage0);
    let mut is_original = true;

    loop {
        let text = source.text.trim_matches('\0');
        dom = Dom::parse(text)?;
        clean_start_of_file(&mut dom);

        let pre_html = find_element(&dom, |node| {
            node.element().filter(|el| el.name.to_lowercase() == "html")
        })
        .ok_or_else(|| no_node("begin of Tar file", "starting `<html>` tag"))?;

        let pre_insertion = find_element(&dom, |node| {
            node.element().filter(|el| {
                el.attributes.get("id").and_then(Option::as_deref) == Some(ID_TAR_CONTENT)
            })
        });

        let pre_stage0 = find_element(&dom, |node| {
            node.element()
                .filter(|el| el.name.to_lowercase() == "script")
                .filter(|el| {
                    el.attributes.get("id").and_then(Option::as_deref) == Some(ID_TAR_STAGE0)
                })
        });

        // If we haven't modified the dom, but we're missing an insertion point, let's try to
        // determine one for us by modifying the dom with an additional element that does not
        // modify the semantics.
        if is_original && (pre_insertion.is_none() || pre_stage0.is_none()) {
            let needs_data = pre_insertion.is_none();
            let needs_stage0 = pre_stage0.is_none();

            if needs_data {
                let head = find_element_mut(&mut dom, |node| {
                    node.element()
                        .filter(|el| el.name.to_lowercase() == "head")
                        .is_some()
                })
                .and_then(|el| match el {
                    lithtml::Node::Element(el) => Some(el),
                    _ => None,
                })
                .ok_or_else(|| {
                    no_node(
                        "fallback location for template data",
                        "the end of `<head>` tag",
                    )
                })?;

                let synth_template = lithtml::Element {
                    name: "template".into(),
                    variant: lithtml::ElementVariant::Normal,
                    attributes: [(Cow::Borrowed("id"), Some(Cow::Borrowed(ID_TAR_CONTENT)))]
                        .into_iter()
                        .collect(),
                    classes: vec![],
                    children: vec![],
                    source_span: head.source_span.clone(),
                };

                head.children.push(lithtml::Node::Element(synth_template));
            }

            if needs_stage0 {
                let body = find_element_mut(&mut dom, |node| {
                    node.element()
                        .filter(|el| el.name.to_lowercase() == "body")
                        .is_some()
                })
                .and_then(|el| match el {
                    lithtml::Node::Element(el) => Some(el),
                    _ => None,
                })
                .ok_or_else(|| {
                    no_node(
                        "fallback location for initialization script data",
                        "the end of `<body>` tag",
                    )
                })?;

                let synth_script = lithtml::Element {
                    name: "script".into(),
                    variant: lithtml::ElementVariant::Normal,
                    attributes: [(Cow::Borrowed("id"), Some(Cow::Borrowed(ID_TAR_STAGE0)))]
                        .into_iter()
                        .collect(),
                    classes: vec![],
                    children: vec![],
                    source_span: body.source_span.clone(),
                };

                body.children
                    .insert(0, lithtml::Node::Element(synth_script));
            }

            *source = SourceDocument::from_reparse(&mut dom);

            is_original = false;
            continue;
        }

        insertion = pre_insertion.ok_or_else(|| {
            no_node(
                "tag marked as insertion point for tar contents",
                &format!("tag with id `{}`", ID_TAR_CONTENT),
            )
        })?;

        stage0 = pre_stage0.ok_or_else(|| {
            no_node(
                "tag marked as insertion point for script entry point",
                &format!("`<script>` tag with id `{}`", ID_TAR_STAGE0),
            )
        })?;

        html = pre_html;

        break;
    }

    let html_insertion_point = source.element_end_of_start_tag(html);

    #[derive(Debug)]
    struct MissingNodeError {
        content: String,
        searched_for: String,
    }

    impl core::fmt::Display for MissingNodeError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(
                f,
                "Missing Node to insert {}, searched for {}",
                self.content, self.searched_for,
            )
        }
    }

    impl Error for MissingNodeError {}

    fn no_node(name: &str, searched: &str) -> Box<dyn Error> {
        Box::new(MissingNodeError {
            content: name.to_string(),
            searched_for: searched.to_string(),
        })
    }

    Ok(Structure {
        html_tag: html.into(),
        html_insertion_point,
        insertion_tag: insertion.into(),
        stage0: stage0.into(),
    })
}

fn parse_file_elements<'dom: 'a, 'a>(
    dom: &'dom Dom<'a>,
) -> Result<Vec<(TarHeader, &'dom Element<'a>)>, Box<dyn Error>> {
    let mut nodes = vec![];

    // This is a visitor and short-circuits for elements we find uninteresting. Just never return
    // anything so the iteration visits every node.
    let _ = find_element(&dom, |node| {
        let el = node
            .element()
            .filter(|el| el.classes.contains(&Cow::Borrowed("wah_polyglot_data")))?;

        // FIXME: this is extra brittle because it is case-sensitive!!
        let given_name = el.attributes.get("data-wahtml_id")?;
        let given_name = given_name.as_deref()?;

        // Cleanup  replacement characters if they exist.
        let given_name = given_name
            .replace('\u{fffd}', "\0")
            .replace("&#65533;", "\0");
        let given_name = given_name.trim_matches('\0');

        if given_name.len() > 100 {
            eprintln!("Warning: file element has too long name, file ignored");
            return None;
        }

        let header = el.attributes.get("data-b")?;
        let header = header.as_deref()?;

        // Same treatment as the name attribute.
        let header = header.replace('\u{fffd}', "\0").replace("&#65533;", "\0");
        let header = header.as_bytes();

        if header.len() > 412 {
            eprintln!("Warning: file element has too long header, file ignored");
            return None;
        }

        let mut bytes = [0u8; 512];
        bytes[100..][..header.len()].copy_from_slice(header);

        let mut header = TarHeader::EMPTY;
        header.assign_from_bytes(&bytes);
        header.name[..given_name.len()].copy_from_slice(given_name.as_bytes());

        nodes.push((header, el));

        None::<()>
    });

    Ok(nodes)
}

// When Chromium saves a file it will leave comments between the doctype and the <html> tag.
fn clean_start_of_file(dom: &mut Dom) {
    dom.children
        .extract_if(.., |node| !matches!(node, Node::Element(_)))
        .fuse()
        .count();
}

fn find_element<'a, T>(dom: &'a Dom, mut with: impl FnMut(&'a Node) -> Option<T>) -> Option<T> {
    let mut stack: Vec<_> = dom.children.iter().collect();

    while let Some(top) = stack.pop() {
        if let Some(find) = with(top) {
            return Some(find);
        }

        let children = top
            .element()
            .into_iter()
            .flat_map(|el| el.children.iter().rev());

        stack.extend(children);
    }

    None
}

fn find_element_mut<'a, 'src>(
    dom: &'a mut Dom<'src>,
    mut with: impl FnMut(&mut Node) -> bool,
) -> Option<&'a mut Node<'src>> {
    let mut stack: Vec<_> = dom.children.iter_mut().collect();

    while let Some(top) = stack.pop() {
        if with(top) {
            return Some(top);
        }

        let children = match top {
            lithtml::Node::Element(el) => Some(el),
            _ => None,
        }
        .into_iter()
        .flat_map(|el| el.children.iter_mut());

        stack.extend(children);
    }

    None
}

impl<'text> SourceDocument<'text> {
    pub fn new(text: &'text str) -> Self {
        let by_line = text.split_inclusive('\n').scan(0usize, |acc, val| {
            let start = *acc;
            *acc += val.len();
            Some(start)
        });

        SourceDocument {
            text: Cow::Borrowed(text),
            by_line: Vec::from_iter(by_line),
        }
    }

    pub fn from_reparse(dom: &mut lithtml::Dom) -> Self {
        // Fix for <https://github.com/Roba1993/lithtml/issues/1>. Empty non-void elements are
        // formatted as self-closing, but HTML does not permit that. We insert a fake empty string
        // node in each one.
        find_element_mut(dom, |node| {
            if let lithtml::Node::Element(el) = node {
                if el.variant == lithtml::ElementVariant::Normal && el.children.is_empty() {
                    el.children.push(lithtml::Node::Text(Cow::Borrowed("")));
                }
            }

            false
        });

        let text: String = dom.to_string();

        let by_line = text.split_inclusive('\n').scan(0usize, |acc, val| {
            let start = *acc;
            *acc += val.len();
            Some(start)
        });

        SourceDocument {
            by_line: Vec::from_iter(by_line),
            text: Cow::Owned(text),
        }
    }

    pub fn span(&self, span: TagSpan) -> ops::Range<usize> {
        let bias = |loc: &SourceCharacter| {
            if loc.line == 1 {
                self.text.len() - self.text.trim_start_matches('\0').len()
            } else {
                0
            }
        };

        // FIXME: unsure if the `column` attribute is by character or byte offset.
        let start = self.by_line[span.start.line.checked_sub(1).unwrap()]
            + bias(&span.start)
            + span.start.column.checked_sub(1).unwrap();
        let end = self.by_line[span.end.line.checked_sub(1).unwrap()]
            + bias(&span.end)
            + span.end.column.checked_sub(1).unwrap();

        start..end
    }

    pub fn element_end_of_start_tag(&self, el: &lithtml::Element) -> usize {
        let span: TagSpan = el.into();

        let non_ending_leq = el
            .attributes
            .keys()
            .chain(el.attributes.values().flat_map(|opt| opt.as_ref()))
            .flat_map(|st| st.chars())
            .filter(|&ch| ch == '>')
            .count();

        let outer_html = &self[self.span(span)];

        let (closing_leq, _) = outer_html
            .char_indices()
            .filter(|&(_, ch)| ch == '>')
            .nth(non_ending_leq)
            .expect("html opening tag not closed?");

        closing_leq + '>'.len_utf8()
    }

    pub fn prepare_tar_structure(&mut self) -> Result<Structure, Box<dyn Error>> {
        parse_tar_tags(self)
    }

    pub fn split_tar_contents(&mut self) -> Result<Vec<TarFile>, Box<dyn Error>> {
        // FIXME: the parser can not handle this. Unfortunate.
        let text = self.text.trim_matches('\0');

        let mut dom = Dom::parse(text)?;
        let elements = parse_file_elements(&dom)?;

        let files = elements.into_iter().flat_map(|(header, element)| {
            if element.children.len() > 1 {
                eprintln!("Warning: file element has too many children, but we will ignore them",);
            }

            let text = element
                .children
                .iter()
                .find_map(|child| child.text())
                .expect("<template> file element has no text child?");

            // See `html_and_tar`, the browser might have inserted line breaks by itself while
            // saving. This cleans them up, there's no risk we have bad base64 data from this..
            let text = text
                .replace('\u{fffd}', "\0")
                .replace("&#65533;", "\0")
                .replace('\r', "")
                .replace('\n', "");

            let bytes = text.trim_matches('\0').trim().as_bytes();

            let content = match TarDecompiler::file_data(&header, bytes) {
                ParsedFileData::Data(content) => content,
                // In fact not a file element.
                ParsedFileData::Nothing => return None,
            };

            Some(TarFile { header, content })
        });

        let files = files.collect();

        // Now clean that data from our DOM, make it into an original document.. There may be
        // comments and text between the doctype and the <html> tag.
        if let Some(html) = dom
            .children
            .iter_mut()
            .filter_map(|node| {
                if let lithtml::Node::Element(el) = node {
                    Some(el)
                } else {
                    None
                }
            })
            .nth(0)
        {
            html.attributes.remove("data-a");
        };

        find_element_mut(&mut dom, |node| {
            if let lithtml::Node::Element(el) = node {
                el.children.retain(|child| {
                    child
                        .element()
                        .filter(|el| el.classes.contains(&Cow::Borrowed("wah_polyglot_data")))
                        .is_none()
                })
            }

            false
        });

        *self = SourceDocument::from_reparse(&mut dom);

        Ok(files)
    }
}

impl<'text> ops::Index<ops::Range<usize>> for SourceDocument<'text> {
    type Output = str;

    fn index(&self, index: ops::Range<usize>) -> &Self::Output {
        &self.text[index]
    }
}

impl<'text> ops::Index<ops::RangeFrom<usize>> for SourceDocument<'text> {
    type Output = str;

    fn index(&self, index: ops::RangeFrom<usize>) -> &Self::Output {
        &self.text[index]
    }
}

impl<'text> ops::Index<ops::RangeFull> for SourceDocument<'text> {
    type Output = str;

    fn index(&self, _: ops::RangeFull) -> &Self::Output {
        &self.text
    }
}

impl From<&'_ lithtml::Element<'_>> for TagSpan {
    fn from(el: &'_ lithtml::Element) -> Self {
        TagSpan {
            start: SourceCharacter {
                line: el.source_span.start_line,
                column: el.source_span.start_column,
            },
            end: SourceCharacter {
                line: el.source_span.end_line,
                column: el.source_span.end_column,
            },
        }
    }
}
