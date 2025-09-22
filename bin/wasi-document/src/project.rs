use std::{io, path::Path, path::PathBuf};

use serde::Deserialize;

/// The merged tool input configuration.
pub struct Configuration {
    pub document: Document,
    pub machine: Machine,
}

impl Configuration {
    pub fn load(args: &super::Args) -> Result<Self, Box<dyn std::error::Error>> {
        let default_cfg = || PathBuf::from("./WasiDocument.toml");
        let base = args.project.clone().unwrap_or_else(default_cfg);

        let Project {
            mut document,
            mut machine,
        } = {
            let contents = std::fs::read_to_string(&base)?;
            toml::from_str(&contents)?
        };

        let dir = base
            .parent()
            .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))?;

        document.absolute_paths(&dir);
        machine.absolute_paths(&dir);

        Ok(Configuration { document, machine })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Project {
    pub document: Document,
    pub machine: Machine,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct Document {
    pub index_html: PathBuf,
    pub root: Option<PathBuf>,
}

#[derive(Deserialize)]
pub struct Machine {
    #[serde(deserialize_with = "BuildStage2::deserialize")]
    pub stage2: Build,
    #[serde(deserialize_with = "BuildStage3::deserialize")]
    pub stage3: Build,
}

impl Document {
    pub fn absolute_paths(&mut self, base: &Path) {
        self.index_html = base.join(&self.index_html);
        if let Some(root) = &mut self.root {
            *root = base.join(&root);
        }
    }
}

impl Machine {
    pub fn absolute_paths(&mut self, base: &Path) {
        Self::absolute_build(&mut self.stage2, base);
        Self::absolute_build(&mut self.stage3, base);
    }

    fn absolute_build(build: &mut Build, base: &Path) {
        match build {
            Build::Rust { package: _, bin: _ } => {}
            Build::Node { workdir, build } => {
                *workdir = base.join(&workdir);
                *build = base.join(&build);
            }
        }
    }
}

#[derive(Debug)]
pub enum Build {
    Rust { package: String, bin: String },
    Node { workdir: PathBuf, build: PathBuf },
}

#[derive(Deserialize)]
#[serde(tag = "flavor", rename_all = "kebab-case")]
pub enum BuildStage2 {
    Node { workdir: PathBuf, build: PathBuf },
}

impl BuildStage2 {
    fn deserialize<'de, D: serde::de::Deserializer<'de>>(de: D) -> Result<Build, D::Error> {
        deserialize_into::<D, Build, Self>(de)
    }
}

impl From<BuildStage2> for Build {
    fn from(value: BuildStage2) -> Self {
        match value {
            BuildStage2::Node { workdir, build } => Build::Node { workdir, build },
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "flavor", rename_all = "kebab-case")]
pub enum BuildStage3 {
    Rust { package: String, bin: String },
}

impl BuildStage3 {
    fn deserialize<'de, D: serde::de::Deserializer<'de>>(de: D) -> Result<Build, D::Error> {
        deserialize_into::<D, Build, Self>(de)
    }
}

impl From<BuildStage3> for Build {
    fn from(value: BuildStage3) -> Self {
        match value {
            BuildStage3::Rust { package, bin } => Build::Rust { package, bin },
        }
    }
}

fn deserialize_into<'de, D, A, B>(de: D) -> Result<A, D::Error>
where
    D: serde::de::Deserializer<'de>,
    B: serde::Deserialize<'de>,
    A: From<B>,
{
    B::deserialize(de).map(Into::into)
}
