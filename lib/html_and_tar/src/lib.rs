use core::ops::Range;

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

#[derive(Default)]
pub struct TarEngine {
    len: u64,
}

#[derive(Default)]
pub struct TarDecompiler {
    len: u64,
}

#[repr(C)]
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

pub struct Entry<'la> {
    /// An ascii name for this file.
    pub name: &'la str,
    /// The data in its raw form. It will be re-encoded to be HTML safe.
    pub data: &'la [u8],
}

pub struct Sparse<'la> {
    /// An ascii name for this file.
    pub name: &'la str,
    /// The real byte length of the file.
    pub realsize: u64,
    /// Where we store this data in actuality.
    pub reference: &'la str,
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

impl TarEngine {
    /// Mangle the HTML prefix such that we can interpret it as a tar header.
    ///
    /// Must not modify HTML semantics.
    pub fn start_of_file(&mut self, html_head: &[u8], entry_offset: usize) -> InitialEscape {
        assert!(html_head.len() < 94);
        assert_eq!(html_head.last().copied(), Some(b'>'));

        let consumed = html_head.len();
        let all_except_close = html_head.len() - 1;

        let mut this = TarHeader::EMPTY;
        this.name[1..][..all_except_close].copy_from_slice(&html_head[..all_except_close]);
        this.name[1..][all_except_close..][..6].copy_from_slice(b" __A=\"");
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

    fn qualify_name_for_html_attribute(name: &str) -> &str {
        assert!(name.is_ascii(), "Name must be ascii");

        // FIXME: more permissive than reality.
        assert!(
            name.chars().all(|c| c != '\"'),
            "Name {name} must be HTML compatible without escapes"
        );

        name
    }

    pub fn escaped_insert_base64(&mut self, Entry { name, data }: Entry) -> EscapedData {
        let qualname = Self::qualify_name_for_html_attribute(name);

        let padding = self.pad_to_fit();
        let data = STANDARD.encode(data).into_bytes();

        const START: &[u8] = b"\0<template class=\"wah_polyglot_data\" __A=\"";
        const DATA_START: &[u8] = b"\">";
        const ID: &[u8] = b"\" _wahtml_id=\"";
        const CONT: &[u8] = b"\" __B=\"";

        let mut this = TarHeader::EMPTY;
        this.name[..START.len()].copy_from_slice(START);
        this.typeflag = b'x';
        this.assign_size(0);
        this.assign_permission_encoding_meta();
        let end_start = this.prefix.len() - ID.len();
        // FIXME: if we add data into this extended header, we must have real control over that
        // data ensuring it is safe as an HTML attribute—so no quotation marks despite the
        // theoretical arbitrary UTF-8 capabilities. Also we should in this case *not* encode the
        // `_wahtml_id` attribute into the prefix but instead a replacement attribute which we then
        // close off and re-open as `_wahtml_id` at the end of the extended header data (probably
        // smuggling it within a pax `comment` value).
        this.prefix[end_start..].copy_from_slice(ID);
        this.assign_checksum();
        self.len += core::mem::size_of::<TarHeader>() as u64;

        let mut file = TarHeader::EMPTY;
        let end_start = this.prefix.len() - DATA_START.len();
        file.name[..qualname.len()].copy_from_slice(qualname.as_bytes());

        // We place the closing quotation for the HTML attribute covering the file name at the end
        // of this field. This does not influence the Tar interpretation (nul-byte is already
        // present) but the wrapping of the rest of the header is then aligned consistently. The
        // HTML attribute is then closed offset in the last standard field `prefix`.
        let cont_place = &mut file.name[qualname.len()..][1..];
        let cont_idx = cont_place.len() - CONT.len();
        cont_place[cont_idx..].copy_from_slice(CONT);
        file.prefix[end_start..].copy_from_slice(DATA_START);

        file.assign_size(data.len());
        file.assign_permission_encoding_meta();
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

    pub fn escaped_continue_base64(&mut self, Entry { name, data }: Entry) -> EscapedData {
        let qualname = Self::qualify_name_for_html_attribute(name);
        let data = STANDARD.encode(data).into_bytes();

        self.continue_qualified(qualname, data, |_, _| {})
    }

    pub fn escaped_continue_sparse(
        &mut self,
        Sparse {
            name,
            realsize,
            reference,
        }: Sparse,
    ) -> EscapedData {
        let qualname = Self::qualify_name_for_html_attribute(name);
        let qualref = Self::qualify_name_for_html_attribute(reference);

        self.continue_qualified(qualname, Vec::new(), |_, file| {
            let realsize_off = 452 - 345;

            file.linkname[1..][..qualref.len()].copy_from_slice(qualref.as_bytes());
            file.typeflag = b'S';
            file.prefix[realsize_off..][..11]
                .copy_from_slice(format!("{realsize:011o}").as_bytes());
            // file.__padding[8..].copy_from_slice(b"tar\0");
        })
    }

    fn continue_qualified(
        &mut self,
        qualname: &str,
        data: Vec<u8>,
        hook: impl FnOnce(&mut TarHeader, &mut TarHeader),
    ) -> EscapedData {
        let padding = self.pad_to_fit();

        const START: &[u8] = b"\0</template><template class=\"wah_polyglot_data\" __A=\"";
        const DATA_START: &[u8] = b"\">";
        const ID: &[u8] = b"\" _wahtml_id=\"";
        const CONT: &[u8] = b"\" __B=\"";

        let mut this = TarHeader::EMPTY;
        this.name[..START.len()].copy_from_slice(START);
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
        let cont_idx = cont_place.len() - CONT.len();
        cont_place[cont_idx..].copy_from_slice(CONT);
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
        let padding = self.pad_to_fit();
        const START: &[u8] = b"\0</template><template>";
        const END: &[u8] = b"\0</template>";

        let mut this = TarHeader::EMPTY;
        this.name[..START.len()].copy_from_slice(START);
        this.assign_size(skip);
        this.prefix[155 - END.len()..].copy_from_slice(END);
        this.assign_permission_encoding_meta();
        this.assign_checksum();

        EscapedSentinel {
            padding,
            header: this,
        }
    }

    /// End a sequence of escaped data with a tar EOF.
    pub fn escaped_eof(&mut self) -> EscapedData {
        EscapedData {
            padding: self.pad_to_fit(),
            header: TarHeader::EMPTY,
            file: TarHeader::EMPTY,
            data: b"</template>".to_vec(),
        }
    }

    /// Outside a data escape block, insert a tar EOF marker.
    pub fn insert_eof(&mut self) -> EscapedData {
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

impl TarDecompiler {
    pub fn start_of_file(&mut self, data: &[u8]) -> ParsedInitial {
        assert!(data.len() >= core::mem::size_of::<TarHeader>());

        let mut this = TarHeader::EMPTY;
        this.assign_from_bytes(data[..512].try_into().unwrap());
        assert_eq!(this.typeflag, b'x');

        let size = this.parse_size().unwrap();
        self.len += core::mem::size_of::<TarHeader>() as u64;
        self.len += size;

        // We ended the original header data before its closing tag and then append 6 bytes of
        // an extra superfluous attribute introducer to it.
        let end_of_original_header = this.name[1..].iter().position(|&b| b == b'\0').unwrap() - 6;
        // Now find where the closing tag is. Which is part of the original data since we skipped
        // it otherwise.
        let continues = data[512..].iter().position(|&b| b == b'>').unwrap();

        ParsedInitial {
            header: 1..end_of_original_header,
            continues: 512 + continues..self.len as usize,
        }
    }

    pub fn next_escape(&mut self, data: &[u8]) -> ParsedEscape {
        self.next_double_header(data)
    }

    pub fn continue_escape(&mut self, data: &[u8]) -> ParsedEscape {
        let mut esc = self.next_double_header(data);

        if let ParsedEscape::Eof { end } = &mut esc {
            const TERMINATOR: &[u8] = b"</template>";
            assert_eq!(data[*end..][..TERMINATOR.len()], *TERMINATOR);
            // We have added the `</template>` outside any header so we need to also skip it here.
            *end += TERMINATOR.len();
        }

        esc
    }

    fn next_double_header(&mut self, data: &[u8]) -> ParsedEscape {
        self.pad_to_fit();

        let Some(data) = data.get(self.len as usize..) else {
            panic!("Ran out of data while looking for next double header");
        };

        let Some(header) = data.get(..512) else {
            panic!("Ran out of data while looking for next double header");
        };

        let mut extension = TarHeader::EMPTY;
        extension.assign_from_bytes(header.try_into().unwrap());

        if extension.prefix.ends_with(b"</template>") {
            let size = extension.parse_size().unwrap();
            self.len += core::mem::size_of::<TarHeader>() as u64;
            let start_of_data = self.len as usize;
            self.len += size;
            let end_of_data = self.len as usize;
            return ParsedEscape::EndOfEscapes {
                html_data: start_of_data..end_of_data,
            };
        }

        let Some(file_raw) = data.get(512..1024) else {
            panic!("Ran out of data while looking for next double header");
        };

        let mut file = TarHeader::EMPTY;
        file.assign_from_bytes(file_raw.try_into().unwrap());
        let size = file.parse_size().unwrap();

        // Now check what we are dealing with.
        if extension.as_bytes() == TarHeader::EMPTY.as_bytes()
            && file.as_bytes() == TarHeader::EMPTY.as_bytes()
        {
            self.len += core::mem::size_of::<TarHeader>() as u64 * 2;

            return ParsedEscape::Eof {
                end: self.len as usize,
            };
        }

        self.len += core::mem::size_of::<TarHeader>() as u64 * 2;
        let file_start = self.len as usize;
        // Followed by the data.
        self.len += size;
        let file_end = self.len as usize;

        assert_eq!(extension.typeflag, b'x');
        assert_eq!(extension.parse_size(), Ok(0));

        ParsedEscape::Entry(file, file_start..file_end)
    }

    fn pad_to_fit(&mut self) {
        self.len = self.len.next_multiple_of(512);
    }
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

    fn parse_size(&self) -> Result<u64, core::num::ParseIntError> {
        if self.size[0] == b'\0' {
            return Ok(0);
        };

        let size_str = core::str::from_utf8(&self.size)
            .unwrap()
            .trim_end_matches('\0');
        u64::from_str_radix(size_str, 8)
    }

    const EMPTY: Self = TarHeader {
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
