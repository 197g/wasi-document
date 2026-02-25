/// Wraps the following simplification:
///
/// ```bash
/// CARGO_PROFILE_RELEASE_OPT_LEVEL=s CARGO_PROFILE_RELEASE_STRIP=true CARGO_PROFILE_RELEASE_DEBUG=none cargo install --git https://github.com/mkeeter/fidget fidget-cli --target wasm32-wasip1  --no-default-features  --root .
/// ```
use std::{error, path, process};
use tempfile::TempDir;
use crate::project::{Install, InstallSource};

pub struct BuildDir {
    dir: TempDir,
    target_dir: Option<path::PathBuf>,
}

impl BuildDir {
    pub fn new(target_dir: Option<path::PathBuf>) -> Result<Self, Box<dyn error::Error>> {
        Ok(Self {
            dir: TempDir::new()?,
            target_dir,
        })
    }

    pub fn command(&self, install: &Install) -> process::Command {
        let mut cmd = process::Command::new("cargo");

        cmd.envs([
            ("CARGO_PROFILE_RELEASE_OPT_LEVEL", "s"),
            ("CARGO_PROFILE_RELEASE_STRIP", "true"),
            ("CARGO_PROFILE_RELEASE_DEBUG", "none"),
        ]);

        if let Some(dir) = &self.target_dir {
            cmd.env("CARGO_TARGET_DIR", dir);
        }

        cmd.args(["install", "--target", "wasm32-wasip1", "--root"]);
        cmd.arg(self.dir.path());

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
            InstallSource::CratesIo => {},
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

    pub fn path_while_alive(&self) -> &std::path::Path {
        self.dir.path()
    }
}
