mod build;
mod cargo;
mod project;
mod tar;

use std::{ffi::CStr, io::Write as _, path::PathBuf};

use clap::Parser;
use wasi_document_dom as dom;

use project::Configuration;

// FIXME: Rethink this as a project setup, i.e. like a `Cargo.toml` file where we can also describe
// the nature of the machine so that this chooses the stage1, stage2, and other parameters for us.
#[derive(Parser)]
enum Args {
    Build {
        // Options.
        /// The path of the configuration file.
        #[arg(long)]
        project: Option<PathBuf>,

        /// A file to write the module to, default to a target folder.
        #[arg(short, long)]
        out: Option<PathBuf>,

        #[arg(long)]
        target_dir: Option<PathBuf>,
    },
    /// Rebuild a tar structure from an HTML document that was modified as a DOM.
    Rebuild {
        #[arg(long)]
        project: Option<PathBuf>,

        #[arg()]
        file: PathBuf,
    },
}

struct Work {
    index_html: PathBuf,
    stage2: Vec<u8>,
    kernel: Vec<u8>,
    edit: bool,
    root_fs: Vec<PathBuf>,
    out: Option<PathBuf>,

    /// Objects that guard a resource required for the others (i.e. tempdirs).
    #[allow(dead_code)]
    resources: Vec<Box<dyn std::any::Any>>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let project = project::Configuration::load(&args)?;

    match args {
        Args::Build { target_dir, .. } => {
            let project = build::generate(&project, target_dir.as_deref())?;
            merge_wasm(&project)
        }
        Args::Rebuild { file, .. } => {
            let project = build::generate(&project, None)?;
            rebuild_wasm(&project, file)
        }
    }
}

fn merge_wasm(project: &Work) -> Result<(), Box<dyn std::error::Error>> {
    let source = std::fs::read_to_string(&project.index_html)?;
    let bootable = finalize_kernel_wasm(&project.kernel, &project.stage2, project)?;

    let mut source = dom::SourceDocument::new(&source);
    let source_script = minify_js(include_bytes!("stage0-html_plus_tar.js"));

    let wasm = tar::build(
        &mut source,
        |push| {
            push(tar::TarItem::Entry(html_and_tar::Entry {
                name: "boot/init",
                data: &bootable,
                attributes: Default::default(),
            }));

            push(tar::TarItem::Entry(html_and_tar::Entry {
                name: "boot/wah-init.wasm",
                data: &bootable,
                attributes: Default::default(),
            }));

            // Note: maybe we want to tag them as by their minor device number?
            for root in &project.root_fs {
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
                    push(tar::TarItem::Entry(html_and_tar::Entry {
                        name,
                        data: &data,
                        attributes: Default::default(),
                    }));
                }
            }

            Ok::<_, Box<dyn std::error::Error>>(())
        },
        Some(&source_script),
    )?;

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

fn rebuild_wasm(project: &Work, file: PathBuf) -> Result<(), Box<dyn std::error::Error>> {
    let source = std::fs::read_to_string(file)?;
    let mut source = dom::SourceDocument::new(&source);
    let files = source.split_tar_contents()?;

    let files = files.iter().flat_map(|file| {
        let wasi_document_dom::TarFile { header, content } = file;
        let cstr = CStr::from_bytes_until_nul(&header.name).ok()?;
        Some(html_and_tar::Entry {
            name: cstr.to_str().ok()?,
            data: content,
            attributes: file.attributes(),
        })
    });

    let wasm = tar::build(
        &mut source,
        move |push| {
            for file in files {
                push(tar::TarItem::Entry(file));
            }

            Ok::<_, Box<dyn std::error::Error>>(())
        },
        None,
    )?;

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

/// The kernel is also the bootloader module. (Maybe not a good idea?).
///
/// Anyways it must contain custom sections with all the customization options from stage1's target
/// onwards. (stage0 gets the boot module's bytes from the file list, stage1 interprets it).
fn finalize_kernel_wasm(
    wasm: &[u8],
    stage2: &[u8],
    args: &Work,
) -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let parser = wasmparser::Parser::default();

    let mut encoder = wasm_encoder::Module::new();

    let custom_stage1;
    // The actual (document) loader that prepares inputs and control for stage 2.
    encoder.section(&wasm_encoder::CustomSection {
        name: "wah_polyglot_stage1",
        data: {
            custom_stage1 = if args.edit {
                assert!(std::env::var_os("WAH_POLYGLOT_EXPERIMENTAL").is_some());
                minify_js(include_bytes!("stage1-edit.js"))
            } else {
                minify_js(include_bytes!("stage1.js"))
            };

            &custom_stage1
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

fn minify_js(bytes: &[u8]) -> Vec<u8> {
    let minified = wasi_document_minify_js::minify_js(bytes);

    eprintln!(
        "Minified size: {} bytes from {}",
        minified.len(),
        bytes.len()
    );

    minified
}
