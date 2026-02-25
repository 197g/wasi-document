## Fidget Example

This invokes `fidget`, an engine for evaluating a quite general group of signed
distance functions efficiently. The result of this is a rendered viewport
looking at a few complex geometries, where the mesh representation and images
themselves which would require more bandwidth to ship and lose the original
analytical form.

## Running

```bash
cargo run -- build --target-dir ../../target/
```

You'll then find the page built as `../../target/wasi.html`.
