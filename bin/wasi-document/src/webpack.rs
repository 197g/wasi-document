//! The wasi-document is defined by its single-file format.
//!
//! To deliver it, over web for instance, however we may want to split it into individual files
//! that can be delivered by separate streams.
use std::path::{Path, PathBuf};

use wasi_document_dom::TarEntryOwned;

pub struct PackRoot<'lt> {
    pub prefix: &'lt str,
    /// Base URL at which files will be available.
    pub url: &'lt str,
    /// Base path at which to dump files in the hierarchy.
    pub path: Option<&'lt Path>,
}

pub struct Packer {
    maps: Vec<Mapper>,
}

struct Mapper {
    prefix: String,
    url: String,
    path: Option<PathBuf>,
}

impl Packer {
    pub fn from_root(root: &[PackRoot]) -> Self {
        fn normalize_to_slash(url_like: &str) -> String {
            if url_like.ends_with('/') {
                url_like.to_owned()
            } else {
                format!("{url_like}/")
            }
        }

        Packer {
            maps: root
                .iter()
                .map(|root| Mapper {
                    prefix: normalize_to_slash(root.prefix),
                    url: normalize_to_slash(root.url),
                    path: root.path.map(Path::to_owned),
                })
                .collect(),
        }
    }

    pub fn process(&self, contents: &mut TarEntryOwned) -> Result<(), std::io::Error> {
        let Some(entry) = contents.as_html_and_tar_entry() else {
            return Ok(());
        };

        // FIXME: if we URL escape the prefix match will hold. But if we do not?
        let raw_name = format!("/{}", entry.name.0);

        for map in &self.maps {
            let Some(relname) = raw_name.strip_prefix(&map.prefix) else {
                continue;
            };

            let components = Path::new(relname).components().filter(|c| {
                matches!(
                    c,
                    std::path::Component::CurDir | std::path::Component::Normal(_)
                )
            });

            if let Some(path) = &map.path {
                let mut fullpath = path.clone();
                fullpath.extend(components);

                if let Some(parent) = fullpath.parent() {
                    std::fs::create_dir_all(parent)?;
                }

                std::fs::write(fullpath, entry.data)?;
            }

            let reference = format!("{}{}", map.url, relname);
            let ref_name = html_and_tar::HtmlAttributeSafeName::new(&reference).unwrap();
            contents.make_external(ref_name);
            return Ok(());
        }

        Ok(())
    }
}
