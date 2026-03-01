/// Learnings:
///
/// Really you should be downloading the page via a hook and a stage3 module that rewrites the
/// document based off its original state so we can curate the DOM modifications. At worst you
/// MUST be able to extract the stored 'filesystem'.
///
/// When saving a page as HTML, browsers will often mangle the source itself. While this destroys
/// the tar structure itself we want to be resilient against it. The following have been observed
/// in practice:
///
/// - The doctype declaration is capitalized.
/// - nul is replace with `\u{fffd}`.
/// - nul is replace with `&#65533;`.
/// - All attributes are normalized to lowercase spelling.
/// - The document is trimmed.
/// - Text nodes have extra whitespace inserted (newlines).
/// - <template> content is removed (i.e. parsed as a #document-fragment that is omitted during
///   serialization) with Save As in Chromium.
/// - Most nodes invoke expensive parseHTML logic in the browser. But noscript does not! The
///   content is technically wrong (only links allowed in head with scripts off) but eh. If you're
///   using this document then you have scripts on and then everything is permissible.
use core::ops::Range;
use std::ffi::CStr;

// See resilience, this text can be rewritten by the browser with line feeds and we can restore the
// original contents just fine.
use base64::{engine::general_purpose::STANDARD, Engine as _};

mod bytemuck {
    pub fn bytes_of(tar: &super::TarHeader) -> &[u8] {
        let len = core::mem::size_of_val(tar);
        unsafe { &*core::slice::from_raw_parts(tar as *const _ as *const u8, len) }
    }

    pub fn bytes_of_mut(tar: &mut super::TarHeader) -> &mut [u8] {
        let len = core::mem::size_of_val(tar);
        unsafe { &mut *core::slice::from_raw_parts_mut(tar as *mut _ as *mut u8, len) }
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct TarHeader {
    pub name: [u8; 100],     /*   0 */
    pub mode: [u8; 8],       /* 100 */
    pub uid: [u8; 8],        /* 108 */
    pub gid: [u8; 8],        /* 116 */
    pub size: [u8; 12],      /* 124 */
    pub mtime: [u8; 12],     /* 136 */
    pub chksum: [u8; 8],     /* 148 */
    pub typeflag: u8,        /* 156 */
    pub linkname: [u8; 100], /* 157 */
    pub magic: [u8; 6],      /* 257 */
    pub version: [u8; 2],    /* 263 */
    pub uname: [u8; 32],     /* 265 */
    pub gname: [u8; 32],     /* 297 */
    pub devmajor: [u8; 8],   /* 329 */
    pub devminor: [u8; 8],   /* 337 */
    pub prefix: [u8; 155],   /* 345 */
    /* 500 */
    __padding: [u8; 12],
}

impl TarHeader {
    pub fn as_bytes(&self) -> &[u8] {
        bytemuck::bytes_of(self)
    }

    pub fn assign_from_bytes(&mut self, data: &[u8; 512]) {
        bytemuck::bytes_of_mut(self).copy_from_slice(data);
    }

    pub fn assign_permission_encoding_meta(&mut self) {
        self.mode.copy_from_slice(b"0000644\0");
        // The usual id for nobody, 65534, in octal is 177776
        self.uid.copy_from_slice(b"0177776\0");
        self.gid.copy_from_slice(b"0177776\0");
        // FIXME: well the project began here.
        self.mtime.copy_from_slice(b"14707041774\0");
        // Use standard star header, this is _not_ an old style GNU header.
        self.magic = *b"ustar\0";
        self.version = *b"  ";
        self.uname[..7].copy_from_slice(b"nobody\0");
        self.gname[..7].copy_from_slice(b"nobody\0");
    }

    pub fn assign_attributes(&mut self, extras: &EntryAttributes) {
        if let Some(mtime) = extras.mtime {
            let mtime = mtime
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_else(|_| Default::default())
                .as_secs();
            let bytes = format!("{mtime:011o}\0");
            self.mtime.copy_from_slice(bytes.as_bytes());
        }

        if let Some(HtmlAttributeSafeName(uname)) = extras.uname {
            let uname_bytes = uname.as_bytes();
            assert!(uname_bytes.len() < self.uname.len() - 1);
            self.uname[..uname_bytes.len()].copy_from_slice(uname_bytes);
            self.uname[uname_bytes.len()] = b'\0';
        }

        if let Some(HtmlAttributeSafeName(gname)) = extras.gname {
            let gname_bytes = gname.as_bytes();
            assert!(gname_bytes.len() < self.gname.len() - 1);
            self.gname[..gname_bytes.len()].copy_from_slice(gname_bytes);
            self.gname[gname_bytes.len()] = b'\0';
        }

        let devmajor = format!("{:o}\0", extras.devmajor);
        self.devmajor[..devmajor.len()].copy_from_slice(devmajor.as_bytes());
        let devminor = format!("{:o}\0", extras.devminor);
        self.devminor[..devminor.len()].copy_from_slice(devminor.as_bytes());
    }

    pub fn assign_checksum(&mut self) {
        let mut acc = 0u32;

        for by in &mut self.chksum {
            *by = b' ';
        }

        for &by in self.as_bytes() {
            acc += u32::from(by);
        }

        let bytes = format!("{acc:06o}\0 ");
        self.chksum.copy_from_slice(bytes.as_bytes());
    }

    fn assign_size(&mut self, size: usize) {
        let bytes = format!("{size:011o}\0");
        // Note: this is numeric, so can not contain a closing quote.
        self.size.copy_from_slice(bytes.as_bytes());
    }

    pub fn parse_size(&self) -> Result<u64, core::num::ParseIntError> {
        if self.size[0] == b'\0' {
            return Ok(0);
        };

        let size_str = CStr::from_bytes_until_nul(&self.size)
            .ok()
            .and_then(|cstr| cstr.to_str().ok())
            .unwrap_or("");

        u64::from_str_radix(size_str, 8)
    }

    pub const EMPTY: Self = TarHeader {
        name: [0; 100],
        mode: [0; 8],
        uid: [0; 8],
        gid: [0; 8],
        size: [0; 12],
        mtime: [0; 12],
        chksum: [0; 8],
        typeflag: 0,
        linkname: [0; 100],
        magic: [0; 6],
        version: [0; 2],
        uname: [0; 32],
        gname: [0; 32],
        devmajor: [0; 8],
        devminor: [0; 8],
        prefix: [0; 155],
        __padding: [0; 12],
    };
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct HtmlAttributeSafeName<'la>(pub &'la str);

impl<'la> HtmlAttributeSafeName<'la> {
    pub const fn new(name: &'la str) -> Result<Self, TarError> {
        if !name.is_ascii() {
            return Err(TarError::NameNotAscii);
        }

        // FIXME: more permissive than reality.
        'contains_bytes: {
            let bytes = name.as_bytes();
            let mut i = 0;

            loop {
                if i >= bytes.len() {
                    break 'contains_bytes;
                }

                if bytes[i] == b'"' {
                    return Err(TarError::NameHasHtmlEscapes);
                }

                i += 1;
            }
        };

        Ok(HtmlAttributeSafeName(name))
    }
}

pub struct Entry<'la> {
    /// An ascii name for this file.
    pub name: HtmlAttributeSafeName<'la>,
    /// The data in its raw form. It will be re-encoded to be HTML safe.
    pub data: &'la [u8],
    /// The metadata for this file.
    pub attributes: EntryAttributes<'la>,
}

#[derive(Clone, Copy)]
pub struct EntryAttributes<'la> {
    pub mtime: Option<std::time::SystemTime>,
    pub uname: Option<HtmlAttributeSafeName<'la>>,
    pub gname: Option<HtmlAttributeSafeName<'la>>,
    pub devmajor: u16,
    pub devminor: u16,
}

impl<'la> EntryAttributes<'la> {
    /// Extract the metadata from an existing tar header.
    pub fn from_header(header: &'la TarHeader) -> Self {
        let mtime = CStr::from_bytes_until_nul(&header.mtime)
            .ok()
            .and_then(|cstr| cstr.to_str().ok())
            .and_then(|mtime| u64::from_str_radix(mtime, 8).ok())
            .map(|secs| std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs));

        let uname = CStr::from_bytes_until_nul(&header.uname)
            .ok()
            .and_then(|cstr| cstr.to_str().ok());

        let gname = CStr::from_bytes_until_nul(&header.gname)
            .ok()
            .and_then(|cstr| cstr.to_str().ok());

        let devmajor = CStr::from_bytes_until_nul(&header.devmajor)
            .ok()
            .and_then(|cstr| cstr.to_str().ok())
            .and_then(|dev| u16::from_str_radix(dev, 8).ok())
            .unwrap_or(0);

        let devminor = CStr::from_bytes_until_nul(&header.devminor)
            .ok()
            .and_then(|cstr| cstr.to_str().ok())
            .and_then(|dev| u16::from_str_radix(dev, 8).ok())
            .unwrap_or(0);

        EntryAttributes {
            mtime,
            uname: uname.map(HtmlAttributeSafeName),
            gname: gname.map(HtmlAttributeSafeName),
            devmajor,
            devminor,
        }
    }
}

impl Default for EntryAttributes<'_> {
    fn default() -> Self {
        Self {
            mtime: None,
            uname: None,
            gname: None,
            devmajor: 0,
            devminor: 0,
        }
    }
}

pub struct External<'la> {
    /// An ascii name for this file.
    pub name: HtmlAttributeSafeName<'la>,
    /// The real byte length of the file.
    pub realsize: u64,
    /// Where we store this data in actuality.
    pub reference: HtmlAttributeSafeName<'la>,
    /// The metadata for this file.
    pub attributes: EntryAttributes<'la>,
}

pub struct InitialEscape {
    /// What Tar header describes the start of the HTML?
    pub header: TarHeader,
    /// How much of the HTML did we consume?
    pub consumed: usize,
    pub extra: Vec<u8>,
}

pub struct EscapedData {
    pub padding: &'static [u8],
    /// The header entry, which transitions us into TAR semantics.
    pub header: TarHeader,
    /// The file entry which closes the HTML tag with the file name visible to both tar as well as
    /// HTML under appropriate attributes.
    pub file: TarHeader,
    pub data: Vec<u8>,
}

pub struct EscapedSentinel {
    pub padding: &'static [u8],
    /// The header entry, which transitions us into TAR semantics.
    pub header: TarHeader,
}

pub struct ParsedInitial {
    pub header: Range<usize>,
    pub continues: Range<usize>,
}

pub enum ParsedEscape {
    Entry(TarHeader, Range<usize>),
    EndOfEscapes { html_data: Range<usize> },
    Eof { end: usize },
}

pub enum ParsedFileData {
    Data(Vec<u8>),
    Nothing,
}

pub enum TarError {
    NameNotAscii,
    NameHasHtmlEscapes,
    NotAStart,
    Num(core::num::ParseIntError),
    NotEnoughData,
    NotAnExpectedEscape,
}

impl core::fmt::Debug for TarError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            TarError::NameNotAscii => write!(f, "file names must be ASCII"),
            TarError::NameHasHtmlEscapes => write!(
                f,
                "file names must not contain characters that can go unescaped in HTML attributes"
            ),
            TarError::NotAStart => write!(f, "this does not look like a tar+html header"),
            TarError::Num(e) => write!(f, "could not parse number in the tar header: {e}"),
            TarError::NotEnoughData => write!(f, "not enough data to iterate tar structure"),
            TarError::NotAnExpectedEscape => write!(f, "the escape ends in an unexpected way"),
        }
    }
}

impl core::fmt::Display for TarError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        core::fmt::Debug::fmt(self, f)
    }
}

impl std::error::Error for TarError {}

#[derive(Default)]
pub struct TarEngine {
    len: u64,
    is_escaped: bool,
}

impl TarEngine {
    /// Mangle the HTML prefix such that we can interpret it as a tar header.
    ///
    /// Must not modify HTML semantics.
    pub fn start_of_file(&mut self, html_head: &[u8], entry_offset: usize) -> InitialEscape {
        let consumed = html_head.len();
        let html_head = Self::doctype_safe_head(html_head);

        const DATA_ESCAPE: &[u8] = b" data-a=\"";
        assert!(html_head.len() < 100 - DATA_ESCAPE.len());
        assert_eq!(html_head.last().copied(), Some(b'>'));

        let all_except_close = html_head.len() - 1;

        let mut this = TarHeader::EMPTY;
        this.name[1..][..all_except_close].copy_from_slice(&html_head[..all_except_close]);
        this.name[1..][all_except_close..][..DATA_ESCAPE.len()].copy_from_slice(DATA_ESCAPE);
        this.typeflag = b'x';

        let tail_len = entry_offset.checked_sub(consumed).unwrap();
        // As payload of this extra header, we mark the HTML content as a comment and also close
        // off the tag itself. Technically, a newline is required but really we only care about not
        // having the data interpreted. So having the decompression think it is truncated is fine.
        let comment_introducer = " comment=\">";
        let extra = format!(
            "{:010}{comment_introducer}",
            comment_introducer.len() + tail_len
        );

        this.assign_size(extra.len() + tail_len);
        this.assign_permission_encoding_meta();
        this.assign_checksum();

        self.len += core::mem::size_of::<TarHeader>() as u64;
        self.len += extra.len() as u64;
        self.len += tail_len as u64;

        InitialEscape {
            header: this,
            // extra refers to all the data we are adding. Which isn't anything yet.
            extra: extra.into_bytes(),
            consumed,
        }
    }

    // Our parser, and probably a few others, will only reliably recognize an actual document if
    // there is a doctype annotation before any other element. Since we add a nul-byte in front of
    // the actual data we will ensure that we are as explicit as possible.
    fn doctype_safe_head(head: &[u8]) -> std::borrow::Cow<'_, [u8]> {
        let has_doctype = String::from_utf8_lossy(head)
            .to_ascii_lowercase()
            .contains("<!doctype");

        if has_doctype {
            std::borrow::Cow::Borrowed(head)
        } else {
            let mut owned = Vec::with_capacity(9 + head.len());
            owned.extend_from_slice(b"<!DOCTYPE html>");
            owned.extend_from_slice(head);
            std::borrow::Cow::Owned(owned)
        }
    }

    pub fn escaped_base64(
        &mut self,
        Entry {
            name,
            data,
            attributes: extras,
        }: Entry,
    ) -> EscapedData {
        let data = STANDARD.encode(data).into_bytes();

        self.continue_qualified(name, data, |_, file| {
            file.assign_attributes(&extras);
        })
    }

    /// Insert a link to external data.
    pub fn escaped_external(
        &mut self,
        External {
            name,
            realsize,
            reference,
            attributes: extras,
        }: External,
    ) -> EscapedData {
        self.continue_qualified(name, Vec::new(), |_, file| {
            let HtmlAttributeSafeName(qualref) = reference;
            let realsize_off = 452 - 345;

            // This does not assign any of the below fields but anyways.
            file.assign_attributes(&extras);

            file.linkname[1..][..qualref.len()].copy_from_slice(qualref.as_bytes());
            file.typeflag = b'S';
            file.prefix[realsize_off..][..11]
                .copy_from_slice(format!("{realsize:011o}").as_bytes());
        })
    }

    fn continue_qualified(
        &mut self,
        HtmlAttributeSafeName(qualname): HtmlAttributeSafeName,
        data: Vec<u8>,
        hook: impl FnOnce(&mut TarHeader, &mut TarHeader),
    ) -> EscapedData {
        let padding = self.pad_to_fit();

        // How to start our extension header for a new escape.
        const START_NAME: &[u8] = b"\0<noscript type=none class=\"wah_polyglot_data\" data-a=\"";
        // How to name our extension header for a continued escape.
        const CONT_NAME: &[u8] =
            b"\0</noscript><noscript type=none class=\"wah_polyglot_data\" data-a=\"";

        const ID: &[u8] = b"\" data-wahtml_id=\"";
        const ID_END_CONT: &[u8] = b"\" data-b=\"";
        const DATA_START: &[u8] = b"\">";

        let start = if self.is_escaped {
            CONT_NAME
        } else {
            self.is_escaped = true;
            START_NAME
        };

        let mut this = TarHeader::EMPTY;
        this.name[..start.len()].copy_from_slice(start);
        this.typeflag = b'x';
        this.assign_size(0);
        this.assign_permission_encoding_meta();
        let end_start = this.prefix.len() - ID.len();
        this.prefix[end_start..].copy_from_slice(ID);
        self.len += core::mem::size_of::<TarHeader>() as u64;

        let mut file = TarHeader::EMPTY;
        let end_start = file.prefix.len() - DATA_START.len();
        file.name[..qualname.len()].copy_from_slice(qualname.as_bytes());

        // We place the closing quotation for the HTML attribute covering the file name at the end
        // of this field. This does not influence the Tar interpretation (nul-byte is already
        // present) but the wrapping of the rest of the header is then aligned consistently. The
        // HTML attribute is then closed offset in the last standard field `prefix`.
        let cont_place = &mut file.name[qualname.len()..][1..];
        let cont_idx = cont_place.len() - ID_END_CONT.len();
        cont_place[cont_idx..].copy_from_slice(ID_END_CONT);
        file.prefix[end_start..].copy_from_slice(DATA_START);

        file.assign_size(data.len());
        file.assign_permission_encoding_meta();

        hook(&mut this, &mut file);

        this.assign_checksum();
        file.assign_checksum();
        self.len += core::mem::size_of::<TarHeader>() as u64;

        // Followed by the data.
        self.len += data.len() as u64;

        EscapedData {
            padding,
            header: this,
            file,
            data,
        }
    }

    /// End a sequence of escaped data, with a particular skip of raw HTML bytes to follow until
    /// the next blocks of such data (again starting as `escaped_insert_base64`).
    pub fn escaped_end(&mut self, skip: usize) -> EscapedSentinel {
        assert!(self.is_escaped);
        let padding = self.pad_to_fit();

        const START: &[u8] = b"\0</noscript><noscript type=none>";
        const END: &[u8] = b"\0</noscript>";

        let mut this = TarHeader::EMPTY;
        this.name[..START.len()].copy_from_slice(START);
        this.assign_size(skip);
        this.prefix[155 - END.len()..].copy_from_slice(END);
        this.assign_permission_encoding_meta();
        this.assign_checksum();

        self.is_escaped = false;

        EscapedSentinel {
            padding,
            header: this,
        }
    }

    /// End a sequence of escaped data with a tar EOF.
    pub fn escaped_eof(&mut self) -> EscapedData {
        if self.is_escaped {
            self.inner_escaped_eof()
        } else {
            self.inner_insert_eof()
        }
    }

    fn inner_escaped_eof(&mut self) -> EscapedData {
        EscapedData {
            padding: self.pad_to_fit(),
            header: TarHeader::EMPTY,
            file: TarHeader::EMPTY,
            data: b"</noscript>".to_vec(),
        }
    }

    pub fn insert_eof(&mut self) -> EscapedData {
        self.escaped_eof()
    }

    /// Outside a data escape block, insert a tar EOF marker.
    fn inner_insert_eof(&mut self) -> EscapedData {
        EscapedData {
            padding: self.pad_to_fit(),
            header: TarHeader::EMPTY,
            file: TarHeader::EMPTY,
            data: vec![],
        }
    }

    fn pad_to_fit(&mut self) -> &'static [u8] {
        static POTENTIAL_PADDING: [u8; 512] = [0; 512];
        let pad = self.len.next_multiple_of(512) - self.len;
        self.len += pad;
        &POTENTIAL_PADDING[..pad as usize]
    }
}

/// Engine for turning a tar archive written by us into its constituent parts.
#[derive(Default)]
pub struct TarDecompiler {
    len: u64,
}

impl TarDecompiler {
    pub fn start_of_file(&mut self, data: &[u8]) -> Result<ParsedInitial, TarError> {
        assert!(data.len() >= core::mem::size_of::<TarHeader>());

        let mut this = TarHeader::EMPTY;
        this.assign_from_bytes(data[..512].try_into().unwrap());
        assert_eq!(this.typeflag, b'x');

        let size = this.parse_size().map_err(TarError::Num)?;
        self.len += core::mem::size_of::<TarHeader>() as u64;
        self.len += size;

        // We ended the original header data before its closing tag and then append 6 bytes of
        // an extra superfluous attribute introducer to it.
        let original_header =
            CStr::from_bytes_until_nul(&this.name[1..]).map_err(|_| TarError::NotAStart)?;
        let end_of_original_header = original_header.to_bytes().len();

        if end_of_original_header <= 6 {
            return Err(TarError::NotAStart);
        }

        // Now find where the closing tag is. Which is part of the original data since we skipped
        // it otherwise.
        let continues = data[512..]
            .iter()
            .position(|&b| b == b'>')
            .ok_or(TarError::NotAStart)?;

        Ok(ParsedInitial {
            header: 1..end_of_original_header - 6,
            continues: 512 + continues..self.len as usize,
        })
    }

    pub fn escaped_data(
        &self,
        data: &[u8],
        escape: &ParsedEscape,
    ) -> Result<ParsedFileData, TarError> {
        match escape {
            ParsedEscape::Entry(header, range) => {
                let data = data.get(range.clone()).ok_or(TarError::NotEnoughData)?;
                Ok(Self::file_data(header, data))
            }
            ParsedEscape::EndOfEscapes { .. } | ParsedEscape::Eof { .. } => {
                Ok(ParsedFileData::Nothing)
            }
        }
    }

    pub fn file_data(header: &TarHeader, data: &[u8]) -> ParsedFileData {
        if header.typeflag == b'x' {
            // This isn't a file, this is a header!
            return ParsedFileData::Nothing;
        }

        if header.typeflag == b'S' {
            // FIXME: this file was outlined from the document. Return the URL reference
            // and checksum for it instead.
            return ParsedFileData::Nothing;
        }

        ParsedFileData::Data(STANDARD.decode(data).unwrap())
    }

    pub fn next_escape(&mut self, data: &[u8]) -> Result<ParsedEscape, TarError> {
        self.next_double_header(data)
    }

    pub fn continue_escape(&mut self, data: &[u8]) -> Result<ParsedEscape, TarError> {
        let mut esc = self.next_double_header(data)?;

        if let ParsedEscape::Eof { end } = &mut esc {
            const TERMINATOR: &[u8] = b"</noscript>";

            if data[*end..][..TERMINATOR.len()] != *TERMINATOR {
                return Err(TarError::NotAnExpectedEscape);
            }

            // We have added the `</template>` outside any header so we need to also skip it here.
            *end += TERMINATOR.len();
        }

        Ok(esc)
    }

    fn next_double_header(&mut self, data: &[u8]) -> Result<ParsedEscape, TarError> {
        self.pad_to_fit();

        let data = data
            .get(self.len as usize..)
            .ok_or(TarError::NotEnoughData)?;
        let header = data.get(..512).ok_or(TarError::NotEnoughData)?;

        let mut extension = TarHeader::EMPTY;
        extension.assign_from_bytes(header.try_into().unwrap());

        if extension.prefix.ends_with(b"</noscript>") {
            let size = extension.parse_size().unwrap();
            self.len += core::mem::size_of::<TarHeader>() as u64;
            let start_of_data = self.len as usize;
            self.len += size;
            let end_of_data = self.len as usize;
            return Ok(ParsedEscape::EndOfEscapes {
                html_data: start_of_data..end_of_data,
            });
        }

        let file_raw = data.get(512..1024).ok_or(TarError::NotEnoughData)?;

        let mut file = TarHeader::EMPTY;
        file.assign_from_bytes(file_raw.try_into().unwrap());
        let size = file.parse_size().unwrap();

        // Now check what we are dealing with.
        if extension.as_bytes() == TarHeader::EMPTY.as_bytes()
            && file.as_bytes() == TarHeader::EMPTY.as_bytes()
        {
            self.len += core::mem::size_of::<TarHeader>() as u64 * 2;

            return Ok(ParsedEscape::Eof {
                end: self.len as usize,
            });
        }

        self.len += core::mem::size_of::<TarHeader>() as u64 * 2;
        let file_start = self.len as usize;
        // Followed by the data.
        self.len += size;
        let file_end = self.len as usize;

        if extension.typeflag != b'x' {
            return Err(TarError::NotAnExpectedEscape);
        }

        if extension.parse_size().map_err(TarError::Num)? != 0 {
            return Err(TarError::NotAnExpectedEscape);
        }

        Ok(ParsedEscape::Entry(file, file_start..file_end))
    }

    fn pad_to_fit(&mut self) {
        self.len = self.len.next_multiple_of(512);
    }
}

#[test]
fn test_tar_header() {
    let attributes = EntryAttributes {
        mtime: Some(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1234)),
        uname: Some(HtmlAttributeSafeName("alice")),
        gname: Some(HtmlAttributeSafeName("bob")),
        devmajor: 42,
        devminor: 24,
    };

    let mut header = TarHeader::EMPTY;
    header.assign_attributes(&attributes);
    header.assign_checksum();

    let after = EntryAttributes::from_header(&header);
    assert_eq!(after.mtime, attributes.mtime);
    assert_eq!(after.uname, attributes.uname);
    assert_eq!(after.gname, attributes.gname);
    assert_eq!(after.devmajor, attributes.devmajor);
    assert_eq!(after.devminor, attributes.devminor);
}
