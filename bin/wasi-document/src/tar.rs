use html_and_tar::{Entry, TarEngine};
use wasi_document_dom as dom;

pub enum TarItem<'data> {
    Entry(Entry<'data>),
}

pub fn build<E>(
    source: &mut dom::SourceDocument,
    elements: impl FnOnce(&mut dyn FnMut(TarItem<'_>)) -> Result<(), E>,
    script: Option<&[u8]>,
) -> Result<Vec<u8>, Box<dyn std::error::Error>>
where
    Box<dyn std::error::Error>: From<E>,
{
    let structure = source.prepare_tar_structure()?;

    let mut engine = TarEngine::default();
    let mut seq_of_bytes: Vec<&[u8]> = vec![];

    let mut head_span = source.span(structure.html_tag);
    head_span.end = head_span.start + structure.html_insertion_point;
    head_span.start = 0;

    let head = &source[head_span];
    let where_to_insert = source.span(structure.insertion_tag);
    let where_to_enter = source.span(structure.stage0);

    assert!(where_to_insert.end < where_to_enter.start);

    let init = engine.start_of_file(head.as_bytes(), where_to_insert.start);
    seq_of_bytes.push(init.header.as_bytes());
    seq_of_bytes.push(init.extra.as_slice());
    seq_of_bytes.push(source[init.consumed..where_to_insert.start].as_bytes());

    let mut insert_with = if false {
        // Force coercion and unification to a function pointer here already.
        html_and_tar::TarEngine::escaped_continue_base64
    } else {
        html_and_tar::TarEngine::escaped_insert_base64
    };

    let mut pushed_data = vec![];
    (elements)(&mut |item| {
        let TarItem::Entry(entry) = item;
        let entry = insert_with(&mut engine, entry);
        insert_with = html_and_tar::TarEngine::escaped_continue_base64;
        pushed_data.push(entry);
    })?;

    for entry in &pushed_data {
        seq_of_bytes.push(entry.padding);
        seq_of_bytes.push(entry.header.as_bytes());
        seq_of_bytes.push(entry.file.as_bytes());
        seq_of_bytes.push(entry.data.as_slice());
    }

    let eof;
    if !pushed_data.is_empty() {
        eof = engine.escaped_eof();
        seq_of_bytes.push(eof.padding);
        seq_of_bytes.push(eof.header.as_bytes());
        seq_of_bytes.push(eof.file.as_bytes());
        seq_of_bytes.push(eof.data.as_slice());
    }

    seq_of_bytes.push(source[where_to_insert.end..where_to_enter.start].as_bytes());

    if let Some(source_script) = script {
        seq_of_bytes.push(b"<script id=WAH_POLYGLOT_HTML_PLUS_TAR_STAGE0>");
        seq_of_bytes.push(&source_script);
        seq_of_bytes.push(b"</script>");
    } else {
        // Insert the original script unchanged but this could be used to update it. This might be
        // one created by `prepare_tar_structure`.
        seq_of_bytes.push(source[where_to_enter.start..where_to_enter.end].as_bytes());
    }

    seq_of_bytes.push(source[where_to_enter.end..].as_bytes());

    Ok(seq_of_bytes.join(&b""[..]))
}
