pub fn minify_js(js: &[u8]) -> Vec<u8> {
    minify(oxc_span::SourceType::jsx(), js)
}

pub fn minify_mjs(mjs: &[u8]) -> Vec<u8> {
    minify(oxc_span::SourceType::mjs(), mjs)
}

fn minify(source_type: oxc_span::SourceType, code: &[u8]) -> Vec<u8> {
    use oxc_allocator::Allocator;
    use oxc_codegen::{Codegen, CodegenOptions, CommentOptions};
    use oxc_minifier::{Minifier, MinifierOptions};
    use oxc_parser::Parser;

    let code = std::str::from_utf8(code).expect("Invalid UTF-8");
    let allocator = Allocator::default();
    let mut parsed = Parser::new(&allocator, code, source_type).parse();

    let options = MinifierOptions::default();
    let minifier = Minifier::new(options);
    let minified = minifier.minify(&allocator, &mut parsed.program);

    let codegen = Codegen::new()
        .with_options(CodegenOptions {
            source_map_path: None,
            minify: true,
            comments: CommentOptions::disabled(),
            ..CodegenOptions::default()
        })
        .with_scoping(minified.scoping)
        .build(&parsed.program);

    codegen.code.into_bytes()
}
