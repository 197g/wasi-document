#![no_main]

use std::sync::mpsc;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use glsmrs as gl;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::{js_sys::AsyncIterator, stream};

#[wasm_bindgen]
pub fn create_renderer(
    pacer: AsyncIterator<wasm_bindgen::JsValue>,
) -> Result<RenderHandle, wasm_bindgen::JsValue> {
    match _create_renderer(pacer) {
        Ok(val) => Ok(val),
        Err(js_val) => {
            // Weirdly this should get thrown but it doesn't. So here's a log in case.
            // NOTE: Found it.. You can call the exported function on the wasm-object directly; but
            // bindgen objects live on a temporary heap until extracted. Only, wasm-bindgen is
            // responsible for lifting the object into JS which it only does if you call the
            // exported method of the ES Module. In other words, wasm-bindgen makes your module
            // necessarily a singleton which is weird.
            log::error!("{js_val:?}");
            Err(js_val)
        }
    }
}

pub fn _create_renderer(
    pacer: AsyncIterator<wasm_bindgen::JsValue>,
) -> Result<RenderHandle, wasm_bindgen::JsValue> {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
    let _ = console_log::init_with_level(log::Level::Info).unwrap();

    let canvas = gl::util::get_canvas("canvas-name")
        .ok_or_else(|| "no such canvas `canvas-name`".to_string())?;
    log::warn!("Canvas found");

    let ctx: web_sys::WebGlRenderingContext = gl::util::get_ctx_from_canvas(&canvas, "webgl")?;
    log::warn!("Rendering context found");

    let ctx = glsmrs::Ctx::new(ctx)?;
    log::warn!("Context created");
    let program = gl::Program::new(&ctx, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE)?;
    log::warn!("Program created");

    let state = GlobalState {
        ctx,
        program: Rc::new(program),
        mesh: Default::default(),
        size: Cell::new((200., 200.)),
    };

    let (sender, mut receiver) = mpsc::channel::<Command>();
    log::info!("Renderer background spawning");

    // FIXME: we want to call `return` on the AsyncIterator but js-sys does not provide it and the
    // wrapper JsStream will not allow us direct access to the value anymore after conversion.
    let mut stream = stream::JsStream::from(pacer);
    wasm_bindgen_futures::spawn_local(async move {
        use futures::stream::StreamExt as _;

        loop {
            let Some(_) = stream.next().await else {
                break;
            };

            state.receive_all(&mut receiver);
            log::info!("Rendering frame");

            let co = RenderState::checkout(&state);
            match co.render() {
                Ok(()) => {}
                Err(_e) => {
                    todo!("Do not panic here, recover? {_e:?}");
                }
            }
        }
    });

    log::info!("Renderer background spawned");
    Ok(RenderHandle { sender })
}

#[wasm_bindgen]
pub struct RenderHandle {
    sender: mpsc::Sender<Command>,
}

#[wasm_bindgen]
impl RenderHandle {
    pub fn set_size(&self, x: f32, y: f32) {
        let _ = self.sender.send(Command::Resize(x, y));
    }

    pub fn set_obj(&self, obj: &str) -> Result<(), wasm_bindgen::JsValue> {
        let mut cursor = std::io::Cursor::new(obj);
        let obj = tobj::load_obj_buf(&mut cursor, &tobj::GPU_LOAD_OPTIONS, |_| {
            Err(tobj::LoadError::OpenFileFailed)
        });

        let models = match obj {
            Ok((models, _)) => models,
            Err(err) => Err(format!("Bad OBJ {err:?}"))?,
        };

        let _ = self.sender.send(Command::Model(models));
        Ok(())
    }
}

/// Commands are always executed in the context of the main renderer. At least, scheduled there.
enum Command {
    Model(Vec<tobj::Model>),
    Resize(f32, f32),
}

fn mk_mesh(ctx: &gl::Ctx, model: &tobj::Model) -> Result<gl::mesh::Mesh, wasm_bindgen::JsValue> {
    // FIXME: render these as multiple meshes? Or instanced probably with a base index.
    let indices: Vec<u16> = model.mesh.indices.iter().map(|&c| c as u16).collect();
    let position = model.mesh.positions.as_chunks::<3>().0;

    let mesh = gl::mesh::Mesh::new(ctx, &indices)?
        .with_attribute::<gl::attributes::AttributeVector3>("in_position", position)?;

    Ok(mesh)
}

struct GlobalState {
    ctx: glsmrs::Ctx,
    // We only have one program. NIT: the type should be Clone, it is two Rc's in disguise. Alas.
    program: Rc<gl::Program>,
    // The meshes to draw.
    mesh: Rc<RefCell<Vec<gl::mesh::Mesh>>>,
    size: Cell<(f32, f32)>,
}

impl GlobalState {
    fn receive_all(&self, receiver: &mut mpsc::Receiver<Command>) {
        while let Ok(item) = receiver.try_recv() {
            let result = match item {
                Command::Model(tobj) => self.set_meshes(&tobj),
                Command::Resize(x, y) => {
                    self.size.set((x, y));
                    Ok(())
                }
            };
        }
    }

    fn set_meshes(&self, models: &[tobj::Model]) -> Result<(), wasm_bindgen::JsValue> {
        let mut meshes = vec![];

        for model in models {
            let mesh = mk_mesh(&self.ctx, &model)?;
            meshes.push(mesh);
        }

        *self.mesh.borrow_mut() = meshes;
        Ok(())
    }
}

struct RenderState {
    ctx: glsmrs::Ctx,
    // We only have one program. NIT: the type should be Clone, it is two Rc's in disguise. Alas.
    program: Rc<gl::Program>,
    // The meshes to draw.
    mesh: Rc<RefCell<Vec<gl::mesh::Mesh>>>,
    // Where to draw into.
    viewport: gl::texture::Viewport,
}

impl RenderState {
    fn checkout(state: &GlobalState) -> Self {
        RenderState {
            ctx: state.ctx.clone(),
            program: state.program.clone(),
            mesh: state.mesh.clone(),
            viewport: {
                let (x, y) = state.size.get();
                gl::texture::Viewport::new(x as u32, y as u32)
            },
        }
    }

    fn render(self) -> Result<(), wasm_bindgen::JsValue> {
        let mut pipeline = gl::Pipeline::new(&self.ctx);

        let mut meshes = self.mesh.borrow_mut();
        let mut displayfb = gl::texture::EmptyFramebuffer::new(&self.ctx, self.viewport);

        pipeline.shade(
            &self.program,
            std::collections::HashMap::new(),
            meshes.iter_mut().collect(),
            &mut displayfb,
        )?;

        Ok(())
    }
}

const VERTEX_SHADER_SOURCE: &str = r#"  #version 100
attribute vec3 in_position;
void main() {
  gl_Position = vec4(in_position, 1.0);
}
"#;

const FRAGMENT_SHADER_SOURCE: &str = r#"  #version 100
precision mediump float;
uniform float blue;
void main() {
  gl_FragColor = vec4(0.0, 0.0, blue, 1.0);
}
"#;

// We want this to be a 'binary' (for `cargo install`) but on Wasm that does not really matter. We
// need this symbol to satisfy the linker though.
#[unsafe(no_mangle)]
pub fn main() {}
