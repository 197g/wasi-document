//! This interpreter converts a declarative wah/WASI configuration into a linear instruction
//! sequence to be interpreted by the `stage2-wasi.js` program.
//!
//! Please do not rely on any of its implementation details (i.e. output). But make use of its
//! format description as a schema (see [`config`][`config`]).

/// Defines the declarative configuration format.
pub mod config;

use std::{io::{Read, Write}, borrow::Cow};

const STACK_CFG: u32 = 0;
const INST_SKIP: u32 = 1;
const INST_STRING: u32 = 2;
const INST_CONST: u32 = 4;
const INST_ARRAY: u32 = 4;
const INST_GET: u32 = 6;
const INST_SET: u32 = 7;
const INST_FILE: u32 = 8;
const INST_DIRECTORY: u32 = 9;
const INST_PREOPEN: u32 = 10;
const INST_OPEN_FILE: u32 = 12;
const INST_SECTION: u32 = 13;
const INST_NOOP: u32 = 14;
const _INST_FUNCTION: u32 = 15;

// Start of user-defined stack values.
const OPS: u32 = 256;

// Marker we use when we mean a value is overwritten by a relocation value.
const RELOC: u32 = 0;

pub fn main() -> Result<(), std::io::Error> {
    let mut buffer = vec![];
    std::io::stdin().read_to_end(&mut buffer)?;

    // Here, parse the configuration and setup WASI.
    let mut stream = StreamState::default();

    // The next loader configuring from WASM.
    let stage3 = mk_stage3(&mut stream);
    // the final executable for which we prepare an environment.
    let exe_file = mk_exe(&mut stream);
    let cfg_fds = mk_cfg_fds(&mut stream);

    let dir_boot = mk_boot(&mut stream, stage3);
    let dir_sbin = mk_sbin(&mut stream, exe_file);
    let dir_proc = mk_proc(&mut stream, exe_file);
    mk_preopen(&mut stream, cfg_fds, Preopen { dir_boot, dir_proc, dir_sbin, exe_file });

    let byte_stream = stream.encode();
    std::io::stdout().write_all(&byte_stream)?;

    Ok(())
}

fn mk_exe(stream: &mut StreamState) -> u32 {
    const STR_WASM: &str = "wasm";

    let txt_wasm = stream.mk_utf8(STR_WASM);
    let wasm = stream.push(&[INST_GET, 2, STACK_CFG, txt_wasm], &[]);
    stream.push(&[INST_FILE, 1, wasm], &[])
}

fn mk_stage3(stream: &mut StreamState) -> u32 {
    const STAGE3_SECTION: &str = "wah_polyglot_stage3";

    let section_txt = stream.mk_utf8(STAGE3_SECTION);
    let sections = stream.push(&[INST_SECTION, 1, section_txt], &[]);
    let c0 = stream.mk_const(0);
    let section = stream.push(&[INST_GET, 2, sections, c0], &[]);
    stream.push(&[INST_FILE, 1, section], &[])
}

fn mk_cfg_fds(stream: &mut StreamState) -> u32 {
    const ENV_FDS: &str = "fds";
    let r_fds_txt = stream.mk_utf8(ENV_FDS);

    stream.push(&[INST_GET, 2, STACK_CFG, r_fds_txt], &[])
}

struct Preopen {
    dir_boot: u32,
    dir_sbin: u32,
    dir_proc: u32,
    exe_file: u32,
}

fn mk_preopen(stream: &mut StreamState, fds: u32, open: Preopen) {
    const STR_BOOT: &str = "boot";
    const STR_PROC: &str = "proc";
    const STR_SBIN : &str = "sbin";
    const STR_PREOPEN: &str = "/";

    let txt_boot = stream.mk_utf8(STR_BOOT);
    let txt_proc = stream.mk_utf8(STR_PROC);
    let txt_sbin = stream.mk_utf8(STR_SBIN);
    let txt_preopen = stream.mk_utf8(STR_PREOPEN);

    let dir = stream.mk_dict();
    stream.push(&[INST_SET, 3, dir, txt_boot, open.dir_boot], &[]);
    stream.push(&[INST_SET, 3, dir, txt_proc, open.dir_proc], &[]);
    stream.push(&[INST_SET, 3, dir, txt_sbin, open.dir_sbin], &[]);
    let dir_preopen = stream.push(&[INST_PREOPEN, 2, txt_preopen, dir], &[]);

    // These are the files for the boot process itself, not the exe afterwards.
    let stdin = open.exe_file;
    let stdout = stream.push(&[INST_ARRAY, 2, 0, 0], &[]);
    let stdout = stream.push(&[INST_FILE, 1, stdout], &[]);
    let stderr = stream.push(&[INST_ARRAY, 2, 0, 0], &[]);
    let stderr = stream.push(&[INST_FILE, 1, stderr], &[]);

    let c0 = stream.mk_const(0);
    let c1 = stream.mk_const(1);
    let c2 = stream.mk_const(2);

    let ostdin = stream.push(&[INST_OPEN_FILE, 1, stdin], &[]);
    stream.push(&[INST_SET, 3, fds, c0, ostdin], &[]);
    let ostdout = stream.push(&[INST_OPEN_FILE, 1, stdout], &[]);
    stream.push(&[INST_SET, 3, fds, c1, ostdout], &[]);
    let ostderr = stream.push(&[INST_OPEN_FILE, 1, stderr], &[]);
    stream.push(&[INST_SET, 3, fds, c2, ostderr], &[]);

    let c3 = stream.mk_const(3);
    stream.push(&[INST_SET, 3, fds, c3, dir_preopen], &[]);
}

fn mk_boot(stream: &mut StreamState, stage3: u32) -> u32 {
    const STR_INIT: &str = "init";

    let txt_init = stream.mk_utf8(STR_INIT);
    let dir = stream.push(&[INST_NOOP, 0], &[]);
    stream.push(&[INST_SET, 3, dir, txt_init, stage3], &[]);
    stream.push(&[INST_DIRECTORY, 1, dir], &[])
}

fn mk_sbin(stream: &mut StreamState, exe_file: u32) -> u32 {
    const STR_INIT: &str = "init";

    let txt_init = stream.mk_utf8(STR_INIT);
    let dir = stream.push(&[INST_NOOP, 0], &[]);
    stream.push(&[INST_SET, 3, dir, txt_init, exe_file], &[]);
    stream.push(&[INST_DIRECTORY, 1, dir], &[])
}

fn mk_proc(stream: &mut StreamState, exe_file: u32) -> u32 {
    const STR_0: &str = "0";
    const STR_1: &str = "1";
    const STR_2: &str = "2";
    const STR_EXE: &str = "exe";
    const STR_FD : &str = "fd";
    const STR_SELF: &str = "self";

    let r_dir = stream.push(&[INST_NOOP, 0], &[]);
    let dir_fd = stream.push(&[INST_NOOP, 0], &[]);

    let txt_0 = stream.mk_utf8(STR_0);
    let txt_1 = stream.mk_utf8(STR_1);
    let txt_2 = stream.mk_utf8(STR_2);
    let txt_exe = stream.mk_utf8(STR_EXE);
    let txt_fd = stream.mk_utf8(STR_FD);
    let txt_self = stream.mk_utf8(STR_SELF);

    let stdin = stream.push(&[INST_ARRAY, 2, 0, 0], &[]);
    let stdin = stream.push(&[INST_FILE, 1, stdin], &[]);
    let stdout = stream.push(&[INST_ARRAY, 2, 0, 0], &[]);
    let stdout = stream.push(&[INST_FILE, 1, stdout], &[]);
    let stderr = stream.push(&[INST_ARRAY, 2, 0, 0], &[]);
    let stderr = stream.push(&[INST_FILE, 1, stderr], &[]);

    stream.push(&[INST_SET, 3, dir_fd, txt_0, stdin], &[]);
    stream.push(&[INST_SET, 3, dir_fd, txt_1, stdout], &[]);
    stream.push(&[INST_SET, 3, dir_fd, txt_2, stderr], &[]);

    let dir_fd = stream.push(&[INST_DIRECTORY, 1, dir_fd], &[]);
    stream.push(&[INST_SET, 3, r_dir, txt_exe, exe_file], &[]);
    stream.push(&[INST_SET, 3, r_dir, txt_fd, dir_fd], &[]);

    let dir_cmd = stream.push(&[INST_DIRECTORY, 1, r_dir], &[]);

    let dir_proc = stream.push(&[INST_NOOP, 0], &[]);
    stream.push(&[INST_SET, 3, dir_proc, txt_self, dir_cmd], &[]);
    stream.push(&[INST_SET, 3, dir_proc, txt_0, dir_cmd], &[]);

    stream.push(&[INST_DIRECTORY, 1, dir_proc], &[])
}

#[derive(Default)]
struct StreamState<'st> {
    pub strings: StringSection<'st>,
    relocations: Vec<(u32, Relocation)>,
    instructions: Vec<u32>,
    stack_size: u32,
}

/// Location points which we have to rewrite before returning.
#[derive(Clone, Copy)]
enum Relocation {
    /// An offset within the literals section.
    Literal(u32),
}

#[derive(Default)]
struct StringSection<'st> {
    buffer: Vec<Cow<'st, [u8]>>,
    offset: u32,
}

impl<'st> StreamState<'st> {
    pub fn push(&mut self, instruction: &[u32], relocations: &[(u32, Relocation)]) -> u32 {
        let base = self.instructions.len() as u32;
        for &(offset, reloc) in relocations {
            self.relocations.push((base+offset, reloc));
        }
        self.instructions.extend_from_slice(instruction);

        let stack_ref = self.stack_size + OPS;
        self.stack_size += 1;
        stack_ref
    }

    pub fn mk_dict(&mut self) -> u32 {
        self.push(&[INST_NOOP, 0], &[])
    }

    pub fn mk_const(&mut self, c: u32) -> u32 {
        self.push(&[INST_CONST, 1, c], &[])
    }

    pub fn mk_utf8(&mut self, txt: &'st str) -> u32 {
        let bytes = txt.as_bytes();
        let node = self.strings.push(bytes);

        self.push(
            &[INST_STRING, 2, RELOC, bytes.len() as u32],
            &[(2, node)])
    }

    pub fn encode(self) -> Vec<u8> {
        let mut byte_stream = vec![0u8; 0];
        byte_stream.extend_from_slice(bytemuck::cast_slice::<_, u8>(&self.instructions));
        let string_offset = self.strings.encode(&mut byte_stream);

        for (location, reloc) in self.relocations {
            let bytes = location as usize * core::mem::size_of::<u32>();
            let bytes: &mut [u8; 4] = (&mut byte_stream[bytes..][..4]).try_into().unwrap();
            let Relocation::Literal(off) = reloc;
            *bytes = (string_offset + u32::from_ne_bytes(*bytes) + off).to_ne_bytes();
        }

        byte_stream
    }
}

impl<'st> StringSection<'st> {
    pub fn push(&mut self, data: impl Into<Cow<'st, [u8]>>) -> Relocation {
        let data = data.into();
        let offset = self.offset;

        self.offset += u32::try_from(data.len()).expect("Unhandled string offset, too much data");
        self.buffer.push(data);

        Relocation::Literal(offset)
    }

    pub fn encode(self, byte_stream: &mut Vec<u8>) -> u32 {
        let pre_start: u32 = u32::try_from(byte_stream.len()).expect("Unhandled strings offset, too much data");
        let post_skip = pre_start + 12;
        let post = post_skip + self.offset;
        let pad = 3 - (post + 3) & 0x3;
        
        byte_stream.extend_from_slice(bytemuck::cast_slice::<u32, u8>(&[INST_SKIP, 1, post+pad]));
        assert_eq!(byte_stream.len(), post_skip as usize);

        for part in &self.buffer {
            byte_stream.extend_from_slice(part);
        }

        assert_eq!(byte_stream.len(), post as usize);

        if pad > 0 {
            byte_stream.extend_from_slice(&[0; 4][..pad as usize]);
        }

        post_skip
    }
}
