use crate::project::{Install, InstallSource, RuntimeTarget};
/// Wraps the following simplification:
///
/// ```bash
/// CARGO_PROFILE_RELEASE_OPT_LEVEL=s CARGO_PROFILE_RELEASE_STRIP=true CARGO_PROFILE_RELEASE_DEBUG=none cargo install --git https://github.com/mkeeter/fidget fidget-cli --target wasm32-wasip1  --no-default-features  --root .
/// ```
use std::{error, path, process};
use tempfile::TempDir;

pub struct BuildDir {
    dir: TempDir,
    wasm_bindgen_origin_dir: TempDir,
    target_dir: Option<path::PathBuf>,
}

impl BuildDir {
    /// Note: we always supply `Some` from `generate` but this interface does not enforce it. Idk.
    /// May be worth exploring if you want to pipe through an environment flag.
    pub fn new(target_dir: Option<path::PathBuf>) -> Result<Self, Box<dyn error::Error>> {
        Ok(Self {
            dir: TempDir::new()?,
            wasm_bindgen_origin_dir: TempDir::new()?,
            target_dir,
        })
    }

    pub fn command(&self, install: &Install) -> process::Command {
        let mut cmd = process::Command::new("cargo");

        let target = match install.target {
            RuntimeTarget::Wasm32Wasip1 => "wasm32-wasip1",
            RuntimeTarget::Wasm32UnknownUnknown => "wasm32-unknown-unknown",
        };

        cmd.envs([
            ("CARGO_PROFILE_RELEASE_OPT_LEVEL", "s"),
            ("CARGO_PROFILE_RELEASE_STRIP", "true"),
            ("CARGO_PROFILE_RELEASE_DEBUG", "none"),
        ]);

        if let Some(dir) = &self.target_dir {
            cmd.env("CARGO_TARGET_DIR", dir);
        }

        cmd.args(["install", "--target", target, "--root"]);
        cmd.arg(if install.wasm_bindgen.is_none() {
            self.dir.path()
        } else {
            self.wasm_bindgen_origin_dir.path()
        });

        match &install.source {
            InstallSource::Git { git, rev } => {
                cmd.args(["--git", git]);
                if let Some(rev) = rev {
                    cmd.args(["--rev", rev]);
                }
            }
            InstallSource::Path { path } => {
                cmd.arg("--path");
                cmd.arg(path);
            }
            InstallSource::CratesIo => {}
        }

        cmd.arg(&install.package);

        if !install.default_features {
            cmd.arg("--no-default-features");
        }

        if let Some(bin) = &install.bin {
            cmd.args(["--bin", bin]);
        }

        cmd.arg("--features");
        cmd.arg(install.features.join(","));

        cmd.arg("--quiet");

        cmd
    }

    pub fn wasm_bindgen(&self, bin: &str, bindgen: &path::Path) -> process::Command {
        assert!(
            bindgen
                .components()
                .all(|cmp| matches!(cmp, path::Component::CurDir | path::Component::Normal(_)))
        );

        let install_path = self.dir.path().join(bindgen);

        let binary_path = self
            .wasm_bindgen_origin_dir
            .path()
            .join(format!("bin/{bin}.wasm"));

        let mut cmd = process::Command::new("wasm-bindgen");

        cmd.envs([
            ("CARGO_PROFILE_RELEASE_OPT_LEVEL", "s"),
            ("CARGO_PROFILE_RELEASE_STRIP", "true"),
            ("CARGO_PROFILE_RELEASE_DEBUG", "none"),
        ]);

        if let Some(dir) = &self.target_dir {
            cmd.env("CARGO_TARGET_DIR", dir);
        }

        cmd.args(["--target", "web", "--no-typescript", "--out-dir"]);
        cmd.arg(install_path);
        cmd.arg(binary_path);

        cmd
    }

    pub fn path_while_alive(&self) -> &std::path::Path {
        self.dir.path()
    }
}
