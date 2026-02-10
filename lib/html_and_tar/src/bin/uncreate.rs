use std::{
    ffi::CStr,
    io::{Read as _, Write as _},
};

use html_and_tar::{ParsedEscape, TarDecompiler};

fn main() {
    let mut stdin = std::io::stdin();
    let mut data = Vec::new();
    stdin.read_to_end(&mut data).unwrap();

    let mut decompiler = TarDecompiler::default();
    let initial = decompiler.start_of_file(&data);
    let mut ranges = vec![initial.header, initial.continues];

    let mut is_in_escape = false;
    loop {
        let parsed = if is_in_escape {
            decompiler.continue_escape(&data)
        } else {
            decompiler.next_escape(&data)
        };

        match parsed {
            ParsedEscape::Entry(file, _) => {
                let name = CStr::from_bytes_until_nul(&file.name).unwrap();
                eprintln!("File: {}", name.to_string_lossy());
                is_in_escape = true;
            }
            ParsedEscape::EndOfEscapes { html_data } => {
                ranges.push(html_data);
                is_in_escape = false;
            }
            ParsedEscape::Eof { end } => {
                ranges.push(end..data.len());
                break;
            }
        }
    }

    let mut stdout = std::io::stdout();
    for range in ranges {
        stdout.write_all(&data[range]).unwrap();
    }
}
