use serde::Deserialize;

#[derive(Deserialize)]
pub struct Config {
    pub input: Input,
    pub output: Output,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct Input {
    /// Literal arguments to use.
    pub args: Vec<String>,
    /// Define environment variables to use.
    /// This is an array but most programs will expect key-value assignments.
    pub env: Vec<String>,
    /// Define how the file system is created from data.
    pub root: Option<FsInMode>,
    /// Identifies the name of the data section to use.
    ///
    /// The usual name is `wah_polyglot_stage2_data`, the default name for the corresponding
    /// packer.
    pub data_section: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FsInMode {
    /// Initialize a file system by unzipping the data section.
    Unzip,
}

/// FIXME: Do we?
#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub struct Output {
    pub stdin: Option<FdOutMode>,
    pub stdout: Option<FdOutMode>,
    pub stderr: Option<FdOutMode>,
    pub root: Option<FsOutMode>,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FdOutMode {
    Data,
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FsOutMode {
    Tree,
}
