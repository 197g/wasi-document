/// Take a project configuration, turn it into the pure WASM work by building the input
/// (load resources, make dependencies, instantiate templates, prepare filesystem).
use crate::project::Build;

use std::{path, process::Command};

pub fn generate(
    configuration: &super::Configuration,
    build: &BuildEnv,
) -> Result<super::Work, Box<dyn std::error::Error>> {
    let stage2 = run_build(&configuration.machine.stage2)?;
    let stage3 = run_build(&configuration.machine.stage3)?;

    let mut root_fs = vec![];
    let mut resources = vec![];

    if let Some(root) = &configuration.document.root {
        root_fs.push(root.to_path_buf())
    };

    if let Some(root) = &configuration.document.install {
        let target_dir = build.target_dir_for_wasm32_wasi().to_owned();
        let builder = crate::cargo::BuildDir::new(Some(target_dir))?;

        let commands = root
            .iter()
            .map(|item| builder.command(item))
            .collect::<Vec<_>>();

        for mut cmd in commands {
            let status = cmd.status()?;
            assert!(status.success());
        }

        for item in root {
            const AUTO_DISCOVERY_EXCUSE: &str = "Using wasm-bindgen needs an explicit binary name. This is blocked on auto-discovery of install targets";

            if let Some(bindgen) = &item.wasm_bindgen {
                let bin = item.bin.as_deref();
                let lib = item.lib.as_deref();

                let bin = bin
                    .or(lib)
                    .ok_or_else(|| String::from(AUTO_DISCOVERY_EXCUSE))?;

                let mut cmd = builder.wasm_bindgen(bin, bindgen);
                let status = cmd.status()?;
                assert!(status.success());
            }
        }

        root_fs.push(builder.path_while_alive().to_path_buf());
        resources.push(Box::new(builder) as Box<dyn std::any::Any>);
    }

    let packers = configuration.web.to_roots(build);

    Ok(super::Work {
        index_html: configuration.document.index_html.clone(),
        stage2: stage2.item,
        kernel: stage3.item,
        edit: false,
        root_fs,
        out: Some(build.cargo_workspace.target_directory.join("wasi.html")),
        packers,
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

pub struct BuildEnv {
    pub(crate) cargo_workspace: CargoMetadata,
    pub(crate) cargo_target_override: Option<path::PathBuf>,
}

impl BuildEnv {
    pub fn new(args: &super::Args) -> Result<Self, Box<dyn std::error::Error>> {
        let project = match args {
            super::Args::Build { project, .. } | super::Args::Repack { project, .. } => project,
        };

        let path = match project {
            None => path::Path::new(".").to_owned(),
            Some(n) => n.canonicalize()?.parent().unwrap().to_owned(),
        };

        let cargo_target_override = match args {
            super::Args::Build { target_dir, .. } => target_dir.clone(),
            super::Args::Repack { .. } => None,
        };

        Ok(Self {
            cargo_workspace: metadata(&path)?,
            cargo_target_override,
        })
    }

    pub fn target_dir_for_wasm32_wasi(&self) -> &path::Path {
        if let Some(dir) = &self.cargo_target_override {
            dir
        } else {
            self.cargo_workspace.target_directory.as_path()
        }
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct CargoMetadata {
    pub target_directory: path::PathBuf,
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
