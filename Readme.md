A packer that adds a webpage to WASI application, making it self-hosted!

## Motivation

At the moment, Browsers can not execute WebAssembly as a native single page
app. Maybe, this will change at some point. Or maybe we should reframe what we
expect the browser to deliver in the first place. This post-processor allows
you to preserve the WebAssembly interpretation, unchanged, while adding an HTML
loader as a sort of platform polyfill, to substitute the native environment
with a billion-dollar platform independent sandbox.

**Not merely a proof-of-concept, nor a joke**. Granted, it started out
that way but there is surprising depth of engineering that accumulated after
the initial rush of ideas. I want to explore turning it into as much of a
serious document format as PDF, but natively on interactive displays with a
solid specification that makes sense to parse. Further, it wrap a robust
foundation for a full operating system.

With the readme below, the system can be understood fully and all its parts
adjusted. Importantly, **You** can do this.

## How to use it

This section is under renovation.

## Tricks related to tar compatibility

The file contents from a root directory and bootstrapping are inserted into the
HTML when choosing the `html+tar` target. Due to compatibility issues and
concerns this can not happen verbatim as bytes. We prioritize the ability to
preserve the original file structure and the majority of its execution model.

- The inline contents of files are encoded as base64.
- We can usually repack a file if its HTML was edited as long as our inserted
  tags are still present. For this we crawl the HTML structure to extract the
  original files while stripping the HTML of our modifications. Repacking is
  necessary to fix some offsets to match the Tar structure. We use
  nul-characters, in attributes or text content, to pad the HTML file as
  necessary.
- Tar headers always come in an pax extension&file pair and have the extensions
  first field, file name, start with a nul-byte after which we have limited
  space for some HTML code that is ignored by tar. We use that to open a
  `<noscript>` tag and stuff the rest of the header into an attribute of the
  tag. We close off that attribute just before the file header so that the
  original file name also becomes an HTML readable attribute (apart from a few
  extra nuls).
- We encode additional data with pax header entries (typeflag='x'). A sequence
  of files is terminated by a sentinel of two extension headers after which
  original HTML data follows. The pax header data itself would be interpreted
  as significant, hence as a main hack, the last header is made to end in a
  comment that closes the escape-tag and then encompasses following HTML data.
  Knowing the byte offset to the next Tar header pair, tar reads over the
  uncontrolled HTML.
- We encode external references as sparse files (typeflag='S'). The linkname
  contains the parent URL where to fetch them.

The file contents are compatible with POSIX:2004 `pax` (GNU tar tries to
implement this) as well as HTML. To get an overview of the contained files with
your standard system tools we recommend:

```bash
tar xf $your_archive_file.html --to-command='echo -n "$TAR_REALNAME: "; base64 -d | file -b -'
```

You may want to modify this as a template for similar interactions with the
contained data. See `man tar` on `--to-command` for some more environment
variables.

## Why this specifically, or reasons against PDF

Let me offer some thoughts on the state of document pages to highlight the
considerations that lead to this specific set of choices for a document
format/or application wrapper.

I think that the format of documents in our current age is very much subpar. We
emulate 'paper' in all the wrong aspects. None of the cozy feeling are present
but all the restrictions and lack of dynamism and interaction, use of processor
power, etc. Why are we working with footnotes when the screen is wide. Why are
graphs static; why are the pictures in the first place and their raw underlying
data not accessible through the document. And; why, despite this being a known
problem for decades, is this problem still rampant?

Partially, Pdf and Adobe does not care. This is somewhat inherent in their
incentive structure. They're built on printing, most basic design decision
still were literally motivated by printers (using CMYK colors, postscript
legacy in paths). A huge part is built on 'legacy support' and nothing to gain
for reducing complexity and generalizing. And all PDF's media support is
frankly stuck in the past, consequently, and this becomes obvious in a
comparison to HTML5. No `<media>`, instead of WebGL some clusterfrick of
half-baked ideas reminiscent of Web3D (anyone remember?), and sandbox and
privacy considerations that could rival FlashPlayer.

PDF is a solution, not a platform. Try to innovate or simply think beyond the
toolbox and you're left stranded. Really we only want some standard API to
render some glyphs, developers will fill in the blanks with code. So instead
let's rebuild what we consider a document with a rendering engine that does
care a little more: *the Browser*. Don't get me wrong, these are plenty complex
as well. Yet here it is the price of comparatively quick iteration and hard
fought compatibility. (The largest threat being maybe Google's current
dominance and the risk of thus amplifying individual unfinished ideas that may
not even be their own. Yes, I do mean the refusal to seriously invest in the
technical feasibility of SPIR-V for initial WebGPU, specifically).

That said you could also regard this wrapper as not only a document engine but
a more general tool for WebAssembly plugins, as a form of hypervisor. Provide a
stage2 loader that emulates the host environment within an HTML page. This
could be, for instance, a WASI environment with a file system in local storage,
a simulation of a complex native network environment, etc. Such an app can be
ran natively or deployed to a browser as a 'hardware-agnostic' alternative,
from a single binary file.

But realistically, the temptation to shoehorn ever more features into the
'system-bindings' underneath your app and thus become very dependent on the
exact hypervisor will be hard to resist. (Look no further than Wasmer and Node
for this principle in action). This will, universally, apply to every system
where one _can_ change the underlying software. If, however, you have reason to
believe any features herein is designed to actively contribute to the effect
the *please* speak up.

## Overview of stages

The program inserts bootstrap sections into the WebAssembly module. These are
designed that the respective readers of other formats (html, zip, pdf)
recognize them *instead* of the WebAssembly module.

For HTML:
- A stage0 section makes the HTML parser stop after a short header, rewrites
  the main document content to a dummy page, then jumps to a module loaded from
  another section by loading that as an ES-Module. It must be the first section
  in the WebAssembly file; and it must be in a specific range of byte-lengths.
- The stage1 section takes this control and sets up a usable environment
  comparable to a single-page app. It replaces the dummy page with an initial
  page from a specially named custom section in the original module. We're free
  to run any Javascript in this module already.
- The stage2 section takes control as if some SPA module.
    - The stage2-yew case will load an application compiled, assembled, and
      packed with Yew, wasm-bindgen (or trunk if needed).
    - The stage2-wasi will now transfer control over to WASI as the main
      driver. It begins by invoking another intermediate stage program to
      control the setup of the WASI system, similar to Unix `init`.
      See [stage2](stage2-loader/Readme.md) for more.
- The default stage3 will now inspect and process the bundled zip data. This
  module takes the role of bootloader for the original module. The zip-file
  will be treated similar to an initial disk. The astute reader might instead
  use another mechanism. The author chose this as it adds transparency to the
  contents of the initial file system and its configuration files.
- The default stage4, finally, is the original WebAssembly module into which
  all these other files are packed!

For PDF [Work-In-Progress]:
- Despite the author being critical of the long-term viability of PDF, some
  people will like if they can send the resulting document such that it
  masquerades as PDF instead of HTML (e.g. a corporate report). Luckily, this
  can be arranged.
- There must be a stage0 header in the first 1kB. This will pretend to open a
  binary stream element to skip over most sections. Then an original document
  is embedded.
- As stage1, the Acrobat JavaScript API might be usable but the author does not
  particular like Acrobat's software development outcomes, in non-commercial
  settings anyways. Media and GPU embeddings are just worse and also badly
  sandboxed versions of the equivalent HTML specifications; and privacy
  nightmares. Nothing was learned from Flash. Experiment on your own.
