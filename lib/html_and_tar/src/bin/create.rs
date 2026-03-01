const HTML: &str = include_str!("example.html");
use std::{borrow::Cow, io::Write as _};

use html_and_tar::{Entry, External, TarEngine};

fn main() {
    const HTMLTAG: &str = "<html";
    const NEEDLE: &str = "HERE_LIE_DRAGONS";

    let html: usize = {
        let start = HTML.find(HTMLTAG).expect("no html tag opened");
        let end = HTML[start..].find(">").expect("no html tag closed");
        start + end + 1
    };

    let where_to_insert = HTML.find(NEEDLE).unwrap() + NEEDLE.len() + 2;

    let mut seq_of_bytes = SeqOfBytes::default();

    let mut engine = TarEngine::default();

    {
        let init = engine.start_of_file(HTML[..html].as_bytes(), where_to_insert);

        seq_of_bytes.own(init.header.as_bytes());
        seq_of_bytes.own(init.extra.as_slice());
        seq_of_bytes.push(HTML[init.consumed..where_to_insert].as_bytes());
    }

    {
        let data = engine.escaped_base64(Entry {
            name: "example0",
            data: b"Hello, world!",
            attributes: Default::default(),
        });

        seq_of_bytes.push(data.padding);
        seq_of_bytes.own(data.header.as_bytes());
        seq_of_bytes.own(data.file.as_bytes());
        seq_of_bytes.own(data.data.as_slice());
    }

    {
        let data = engine.escaped_external(External {
            name: "InWonderland",
            realsize: 6,
            reference: "Go ask Alice",
            attributes: Default::default(),
        });
        seq_of_bytes.push(data.padding);

        seq_of_bytes.own(data.header.as_bytes());
        seq_of_bytes.own(data.file.as_bytes());
        seq_of_bytes.own(data.data.as_slice());
    }

    {
        let data = engine.escaped_base64(Entry {
            name: "Emporingen",
            data: b"Off with their heads",
            attributes: Default::default(),
        });
        seq_of_bytes.push(data.padding);

        seq_of_bytes.own(data.header.as_bytes());
        seq_of_bytes.own(data.file.as_bytes());
        seq_of_bytes.own(data.data.as_slice());
    }

    {
        let end = engine.escaped_eof();
        seq_of_bytes.push(end.padding);
        seq_of_bytes.own(end.header.as_bytes());
        seq_of_bytes.own(end.file.as_bytes());
        seq_of_bytes.own(end.data.as_slice());

        seq_of_bytes.push(HTML[where_to_insert..].as_bytes());
    }

    let stdout = std::io::stdout();
    let mut stdout = stdout.lock();

    for item in &seq_of_bytes.inner {
        stdout.write_all(item).unwrap();
    }
}

#[derive(Default)]
struct SeqOfBytes<'lt> {
    inner: Vec<Cow<'lt, [u8]>>,
}

impl<'lt> SeqOfBytes<'lt> {
    pub fn push(&mut self, data: &'lt [u8]) {
        self.inner.push(data.into())
    }

    pub fn own(&mut self, data: &[u8]) {
        self.inner.push(data.to_vec().into())
    }
}
