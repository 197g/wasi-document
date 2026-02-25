/// Take a project configuration, turn it into the pure WASM work by building the input
/// (load resources, make dependencies, instantiate templates, prepare filesystem).
use crate::project::Build;

use std::{path, process::Command};

pub fn generate(
    configuration: &super::Configuration,
    cargo_target_dir: Option<&path::Path>,
) -> Result<super::Work, Box<dyn std::error::Error>> {
    let stage2 = run_build(&configuration.machine.stage2)?;
    let stage3 = run_build(&configuration.machine.stage3)?;

    let mut root_fs = vec![];
    let mut resources = vec![];

    if let Some(root) = &configuration.document.root {
        root_fs.push(root.to_path_buf())
    };

    if let Some(root) = &configuration.document.install {
        let builder = crate::cargo::BuildDir::new(cargo_target_dir.map(path::Path::to_path_buf))?;

        let commands = root
            .iter()
            .map(|item| builder.command(item))
            .collect::<Vec<_>>();

        for mut cmd in commands {
            let status = cmd.status()?;
            assert!(status.success());
        }

        root_fs.push(builder.path_while_alive().to_path_buf());
        resources.push(Box::new(builder) as Box<dyn std::any::Any>);
    }

    let meta = metadata(path::Path::new("."))?;

    Ok(super::Work {
        index_html: configuration.document.index_html.clone(),
        stage2: stage2.item,
        kernel: stage3.item,
        edit: false,
        root_fs,
        out: Some(meta.target_directory.join("wasi.html")),
        resources,
    })
}

struct BuiltResource {
    item: Vec<u8>,
}

fn run_build(build: &Build) -> Result<BuiltResource, Box<dyn std::error::Error>> {
    let item = match build {
        Build::Rust { package, bin } => {
            Command::new("cargo")
                .arg("build")
                .arg("-p")
                .arg(&package)
                .args(["--target", "wasm32-wasip1", "--release"])
                .args(["--bin", bin])
                .stdin(std::process::Stdio::null())
                .status()
                .inspect(|x| assert!(x.success()))?;

            let meta = metadata(path::Path::new("."))?;
            let path = format!("wasm32-wasip1/release/{bin}.wasm");

            std::fs::read(meta.target_directory.join(path))?
        }
        Build::Node { workdir, build } => {
            Command::new("node")
                .stdin(std::process::Stdio::null())
                .current_dir(workdir)
                .stdin(std::fs::File::open(workdir.join(build))?)
                .status()
                .inspect(|x| assert!(x.success()))?;

            std::fs::read(workdir.join("out.js"))?
        }
    };

    Ok(BuiltResource { item })
}

#[derive(serde::Deserialize)]
struct CargoMetadata {
    target_directory: path::PathBuf,
}

fn metadata(build: &path::Path) -> Result<CargoMetadata, Box<dyn std::error::Error>> {
    let output = Command::new("cargo")
        .args(["metadata", "--format-version", "1"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .current_dir(build)
        .output()
        .inspect(|x| assert!(x.status.success()))?;

    Ok(serde_json::from_slice(&output.stdout)?)
}
