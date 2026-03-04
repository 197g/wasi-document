mod build;
mod cargo;
mod project;
mod tar;
mod webpack;

use std::{io::Write as _, path::PathBuf};

use clap::Parser;
use html_and_tar::HtmlAttributeSafeName;
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
    /// Repack a tar structure from an HTML document that was modified as a DOM.
    Repack {
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

    packers: Vec<project::ConfiguredPackRoot>,

    /// Objects that guard a resource required for the others (i.e. tempdirs).
    #[allow(dead_code)]
    resources: Vec<Box<dyn std::any::Any>>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let project = project::Configuration::load(&args)?;
    let build = build::BuildEnv::new(&args)?;

    match args {
        Args::Build { .. } => {
            let project = build::generate(&project, &build)?;
            merge_wasm(&project)
        }
        Args::Repack { file, .. } => {
            let project = build::generate(&project, &build)?;
            rebuild_wasm(&project, file)
        }
    }
}

const BOOT_KERNEL_NAME: HtmlAttributeSafeName =
    match HtmlAttributeSafeName::new("boot/wah-init.wasm") {
        Ok(name) => name,
        Err(_) => panic!("Invalid attribute name, should be hardcoded and valid"),
    };

fn merge_wasm(project: &Work) -> Result<(), Box<dyn std::error::Error>> {
    let source = std::fs::read_to_string(&project.index_html)?;
    let bootable = finalize_kernel_wasm(&project.kernel, &project.stage2, project)?;
    let roots: Vec<_> = project.packers.iter().map(|pck| pck.as_root()).collect();

    let mut source = dom::SourceDocument::new(&source);
    let source_script = minify_js(include_bytes!("stage0-html_plus_tar.js"));
    let packer = crate::webpack::Packer::from_root(&roots);

    let wasm = tar::build(
        &mut source,
        |push| {
            push(tar::TarItem::Entry(html_and_tar::Entry {
                name: BOOT_KERNEL_NAME,
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

                    let Ok(name) = HtmlAttributeSafeName::new(name) else {
                        // FIXME: warn or transparently encode? URL-safe sounds nice.
                        continue;
                    };

                    if !meta.is_file() {
                        continue;
                    }

                    // FIXME: should be able to represent the file without reading it into memory.
                    // We need the size for that, i.e. `html_and_tar` does not want to do the
                    // metadata read itself to support file descriptors backed not be a filesytem
                    // with metadata.
                    let data = std::fs::read(&full_path)?;

                    let mut entry = dom::TarEntryOwned::from_entry(html_and_tar::Entry {
                        name,
                        data: &data,
                        attributes: Default::default(),
                    });

                    packer.process(&mut entry)?;

                    if let Some(entry) = entry.as_html_and_tar_entry() {
                        push(tar::TarItem::Entry(entry));
                    } else if let Some(external) = entry.as_html_and_tar_external() {
                        push(tar::TarItem::External(external));
                    } else {
                        todo!()
                    };
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
    let mut entries = source.split_tar_contents()?;

    let packer = crate::webpack::Packer::from_root(&[]);

    for item in &mut entries {
        packer.process(item)?;
    }

    let files = entries.iter().flat_map(|entry| {
        if let Some(entry) = entry.as_html_and_tar_entry() {
            Some(tar::TarItem::Entry(entry))
        } else if let Some(external) = entry.as_html_and_tar_external() {
            Some(tar::TarItem::External(external))
        } else {
            None
        }
    });

    let wasm = tar::build(
        &mut source,
        move |push| {
            files.into_iter().for_each(push);
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
