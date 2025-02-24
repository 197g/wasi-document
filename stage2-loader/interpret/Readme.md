Convert a configuration into a specific binary form.

The structure of the configuration is documented in
[src/config.rs](src/config.rs) as a serde structure. There is a focus on
keeping it declarative. The only inputs to this declarative process is the data
section attached.

The binary instruction stream can be analyzed during loader compilation to omit
modules that are never utilized. For instance, the interpreter itself need only
be attached if new configuration files may be read dynamically. The possible
configuration is supposed to be sufficient but not excessive. Indeed, it seems
rather more interesting to investigate the Commands&Reactors proposal and how
more complex WebAssembly modules could bootstrap themselves.

TODO: obviously we want to do something with the output. Something useful like
displaying it. However, this is impure and depends on the environment, the
browser. This undermines the reasoning that the program behaves the same
regardless of environment. How to resolve this contradiction?
