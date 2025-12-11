mod build;
mod project;

use std::{io::Write as _, path::PathBuf};

use clap::Parser;
use wasi_document_dom as dom;

use project::Configuration;

// FIXME: Rethink this as a project setup, i.e. like a `Cargo.toml` file where we can also describe
// the nature of the machine so that this chooses the stage1, stage2, and other parameters for us.
#[derive(Parser)]
struct Args {
    // Options.
    /// The path of the configuration file.
    #[arg(long)]
    project: Option<PathBuf>,

    /// A file to write the module to, default to a target folder.
    #[arg(short, long)]
    out: Option<PathBuf>,
}

struct Work {
    index_html: PathBuf,
    stage2: Vec<u8>,
    kernel: Vec<u8>,
    /// The "user-space" init process to use.
    init: Vec<u8>,
    edit: bool,
    root_fs: Option<PathBuf>,
    out: Option<PathBuf>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let project = project::Configuration::load(&args)?;
    let project = build::generate(&project)?;
    merge_wasm(&project)
}

fn merge_wasm(project: &Work) -> Result<(), Box<dyn std::error::Error>> {
    let source = std::fs::read_to_string(&project.index_html)?;
    let binary_wasm = finalize_wasm(&project.init, &project.stage2, project)?;

    let mut source = dom::SourceDocument::new(&source);
    let source_script = include_bytes!("stage0-html_plus_tar.js");

    let structure = source.prepare_tar_structure()?;

    let mut engine = html_and_tar::TarEngine::default();
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

    let mut pushed_data = vec![];

    pushed_data.push(engine.escaped_insert_base64(html_and_tar::Entry {
        name: "boot/init",
        data: &project.kernel,
    }));

    pushed_data.push(engine.escaped_continue_base64(html_and_tar::Entry {
        name: "boot/wah-init.wasm",
        data: &binary_wasm,
    }));

    if let Some(root) = &project.root_fs {
        let iter = walkdir::WalkDir::new(root).same_file_system(true);

        for entry in iter {
            let entry = entry?;

            let full_path = entry.path();
            let meta = entry.metadata()?;

            let Ok(path) = full_path.strip_prefix(&root) else {
                continue;
            };

            let Some(name) = path.to_str() else {
                continue;
            };

            if !meta.is_file() {
                continue;
            }

            let data = std::fs::read(&full_path)?;

            let entry = engine.escaped_continue_base64(html_and_tar::Entry { name, data: &data });

            pushed_data.push(entry);
        }
    }

    for data in &pushed_data {
        seq_of_bytes.push(data.padding);
        seq_of_bytes.push(data.header.as_bytes());
        seq_of_bytes.push(data.file.as_bytes());
        seq_of_bytes.push(data.data.as_slice());
    }

    // FIXME: not sure if we should just do the open-end thing instead of EOF..

    let eof = engine.escaped_eof();
    seq_of_bytes.push(eof.padding);
    seq_of_bytes.push(eof.header.as_bytes());
    seq_of_bytes.push(eof.file.as_bytes());
    seq_of_bytes.push(eof.data.as_slice());

    seq_of_bytes.push(source[where_to_insert.end..where_to_enter.start].as_bytes());
    seq_of_bytes.push(b"<script>");
    seq_of_bytes.push(source_script);
    seq_of_bytes.push(b"</script>");
    seq_of_bytes.push(source[where_to_enter.end..].as_bytes());

    let wasm = seq_of_bytes.join(&b""[..]);

    match &project.out {
        None => {
            let mut stdout = std::io::stdout();
            stdout.write_all(&wasm)?;
        }
        Some(path) => {
            std::fs::write(path, &wasm)?;
        }
    }

    Ok(())
}

fn finalize_wasm(
    wasm: &[u8],
    stage2: &[u8],
    args: &Work,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let parser = wasmparser::Parser::default();

    let mut encoder = wasm_encoder::Module::new();

    // The actual (document) loader that prepares inputs and control for stage 2.
    encoder.section(&wasm_encoder::CustomSection {
        name: "wah_polyglot_stage1",
        data: if args.edit {
            assert!(std::env::var_os("WAH_POLYGLOT_EXPERIMENTAL").is_some());
            include_bytes!("stage1-edit.js")
        } else {
            include_bytes!("stage1.js")
        },
    });

    // FIXME: hm, a replacement section may be harmful. We expect that the loader up to stage2 can
    // somehow revert the embedding, including normalizing any remote data into the document, so
    // that we can rely on repacking the finalized document if it was modified or offered as a
    // download standalone. If we switch to an arbitrary other document we need to ensure it is not
    // destructive to that capability. Hence, not supported yet.

    /*
        if let Some(index) = &args.index_html {
            let index_html = std::fs::read(index)?;

            encoder.section(&wasm_encoder::CustomSection {
                name: "wah_polyglot_stage1_html",
                data: &index_html,
            });
        }
    */

    encoder.section(&wasm_encoder::CustomSection {
        name: "wah_polyglot_stage2",
        data: stage2,
    });

    for section in parser.parse_all(&wasm) {
        if let Some((id, data_range)) = section?.as_section() {
            encoder.section(&wasm_encoder::RawSection {
                id,
                data: &wasm[data_range],
            });
        }
    }

    Ok(encoder.finish())
}
