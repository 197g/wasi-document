#![no_main]

use std::sync::mpsc;
use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use glsmrs as gl;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::js_sys::Number;
use wasm_bindgen_futures::{js_sys::AsyncIterator, stream};

#[wasm_bindgen]
pub fn create_renderer(
    pacer: AsyncIterator<Number>,
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
    pacer: AsyncIterator<Number>,
) -> Result<RenderHandle, wasm_bindgen::JsValue> {
    std::panic::set_hook(Box::new(console_error_panic_hook::hook));
    let _ = console_log::init_with_level(log::Level::Info).unwrap();

    let canvas = gl::util::get_canvas("canvas-name")
        .ok_or_else(|| "no such canvas `canvas-name`".to_string())?;
    log::info!("Canvas found");

    let ctx: web_sys::WebGlRenderingContext = gl::util::get_ctx_from_canvas(&canvas, "webgl")?;
    log::info!("Rendering context found");

    let ctx = glsmrs::Ctx::new(ctx)?;
    log::info!("Context created");
    let program = gl::Program::new(&ctx, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE)?;
    log::info!("Program created");

    let state = GlobalState {
        ctx,
        program: Rc::new(program),
        mesh: Default::default(),
        size: Cell::new((200., 200.)),
        camera: Cell::new([0., 0., 0., 1.]),
        dragged_point: Cell::new(None),
        auto_rotate: Cell::new({
            let angle = 0.25;
            let axis = [0.2, 0.5, 0.0];
            Some((angle, axis))
        }),
        time: Cell::new(0.0),
    };

    let (sender, mut receiver) = mpsc::channel::<Command>();
    log::info!("Renderer background spawning");

    // FIXME: we want to call `return` on the AsyncIterator but js-sys does not provide it and the
    // wrapper JsStream will not allow us direct access to the value anymore after conversion.
    let mut stream = stream::JsStream::from(pacer);
    wasm_bindgen_futures::spawn_local(async move {
        use futures::stream::StreamExt as _;

        loop {
            let Some(Ok(ts)) = stream.next().await else {
                break;
            };

            let render_at = ts.value_of();

            state.receive_all(&mut receiver);
            log::trace!("Rendering frame");

            if let Some(quat) = state.auto_quaternion(render_at) {
                state.rotate_quat(quat);
            }

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
    #[wasm_bindgen]
    pub fn set_size(&self, x: f32, y: f32) {
        log::info!("Changing canvas size: {x}×{y}");
        let _ = self.sender.send(Command::Resize(x, y));
    }

    #[wasm_bindgen]
    pub fn set_obj(&self, obj: &str) -> Result<(), wasm_bindgen::JsValue> {
        let mut cursor = std::io::Cursor::new(obj);
        let obj = tobj::load_obj_buf(&mut cursor, &tobj::GPU_LOAD_OPTIONS, |_| {
            Err(tobj::LoadError::OpenFileFailed)
        });

        let models = match obj {
            Ok((models, _)) => models,
            Err(err) => Err(format!("Bad OBJ {err:?}"))?,
        };

        self.sender
            .send(Command::Model(models))
            .map_err(|e| format!("No longer in control: {e}"))?;

        Ok(())
    }

    #[wasm_bindgen]
    pub fn set_autopanning(
        &self,
        x: f32,
        y: f32,
        z: f32,
        speed: Option<f32>,
    ) -> Result<(), wasm_bindgen::JsValue> {
        self.sender
            .send(Command::Autopanning {
                speed,
                axis: [x, y, z],
            })
            .map_err(|e| format!("No longer in control: {e}"))?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn drag_relative(&self, right: f32, down: f32) -> Result<(), wasm_bindgen::JsValue> {
        self.sender
            .send(Command::DragRotation { right, down })
            .map_err(|e| format!("No longer in control: {e}"))?;
        Ok(())
    }

    #[wasm_bindgen]
    pub fn drag_release(&self) -> Result<(), wasm_bindgen::JsValue> {
        self.sender
            .send(Command::DragRelease)
            .map_err(|e| format!("No longer in control: {e}"))?;
        Ok(())
    }
}

/// Commands are always executed in the context of the main renderer. At least, scheduled there.
enum Command {
    Autopanning { speed: Option<f32>, axis: [f32; 3] },
    Model(Vec<tobj::Model>),
    Resize(f32, f32),
    DragRotation { right: f32, down: f32 },
    DragRelease,
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
    size: Cell<(f32, f32)>,

    /// We only have one program. NIT: the type should be Clone, it is two Rc's in disguise. Alas.
    program: Rc<gl::Program>,
    /// The meshes to draw.
    mesh: Rc<RefCell<Vec<gl::mesh::Mesh>>>,
    camera: Cell<[f32; 4]>,

    /// Interaction (host-side state)
    dragged_point: Cell<Option<(f32, f32)>>,
    /// Advance camera position per second.
    auto_rotate: Cell<Option<(f32, [f32; 3])>>,
    /// Simulated time (for auto rotation etc.)
    time: Cell<f64>,
}

impl GlobalState {
    fn receive_all(&self, receiver: &mut mpsc::Receiver<Command>) {
        while let Ok(item) = receiver.try_recv() {
            let result = match item {
                Command::Autopanning { speed, axis } => {
                    self.auto_rotate.set(if let Some(s) = speed {
                        Some((s, axis))
                    } else {
                        None
                    });

                    Ok(())
                }
                Command::Model(tobj) => self.set_meshes(&tobj),
                Command::Resize(x, y) => {
                    self.size.set((x, y));
                    Ok(())
                }
                Command::DragRotation { right, down } => {
                    self.pan(right, down);
                    Ok(())
                }
                Command::DragRelease => {
                    let q = self.dragged_quanternion();
                    self.dragged_point.set(None);
                    self.rotate_quat(q);
                    Ok(())
                }
            };

            if let Err(e) = result {
                log::warn!("Ignored command as a result of {e:?}");
            }
        }
    }

    fn pan(&self, right: f32, down: f32) {
        self.dragged_point.set(Some((right, down)));
    }

    fn dragged_quanternion(&self) -> [f32; 4] {
        let Some((right, down)) = self.dragged_point.get() else {
            return [1.0, 0.0, 0.0, 0.0];
        };

        let len = (right.powf(2.0) + down.powf(2.0)).sqrt();
        let (s, c) = (len * core::f32::consts::PI).sin_cos();

        if len >= 1e-6 {
            [c, s * -right / len, s * down / len, 0.0]
        } else {
            [1.0, 0.0, 0.0, 0.0]
        }
    }

    fn auto_quaternion(&self, at: f64) -> Option<[f32; 4]> {
        let (angle, axis) = self.auto_rotate.get()?;
        let dt = (at - self.time.replace(at)).clamp(0.0, 0.016);

        let [sx, sy, sz] = axis.map(|coord| coord.powi(2));
        let len = (sx + sy + sz).sqrt();

        let (s, c) = (angle * dt as f32).sin_cos();
        let (c, axis_coef) = if len < 1e-6 { (1.0, 0.0) } else { (c, s / len) };

        let [x, y, z] = axis.map(|coord| coord * axis_coef);
        Some([c, x, y, z])
    }

    fn rotate_quat(&self, q: [f32; 4]) {
        let nq = Self::quat_mul(q, self.camera.get());
        self.camera.set(nq);
    }

    fn quat_mul(p: [f32; 4], q: [f32; 4]) -> [f32; 4] {
        fn cross(l: (f32, f32), r: (f32, f32)) -> f32 {
            l.0 * r.1 - l.1 * r.0
        }

        let [p0, pi, pj, pk] = p;
        let [q0, qi, qj, qk] = q;

        let a = p0 * q0 - pi * qi - pj * qj - pk * qk;

        let pt = [pi, pj, pk].map(|n| n * q0);
        let qt = [qi, qj, qk].map(|n| n * p0);

        let c = [
            cross((pj, pk), (qj, qk)),
            cross((pk, pi), (qk, qi)),
            cross((pi, pj), (qi, qj)),
        ];

        [
            a,
            pt[0] + qt[0] + c[0],
            pt[1] + qt[1] + c[1],
            pt[2] + qt[2] + c[2],
        ]
    }

    fn set_meshes(&self, models: &[tobj::Model]) -> Result<(), wasm_bindgen::JsValue> {
        let mut meshes = vec![];
        let tris: usize = models.iter().map(|m| m.mesh.indices.len() / 3).sum();

        for model in models {
            let mesh = mk_mesh(&self.ctx, &model)?;
            meshes.push(mesh);
        }

        log::info!("Assigning {} meshes, {tris} triangles", meshes.len());
        *self.mesh.borrow_mut() = meshes;
        Ok(())
    }
}

struct RenderState {
    ctx: glsmrs::Ctx,
    /// We only have one program. NIT: the type should be Clone, it is two Rc's in disguise. Alas.
    program: Rc<gl::Program>,
    /// The meshes to draw.
    mesh: Rc<RefCell<Vec<gl::mesh::Mesh>>>,
    /// Where to draw into.
    viewport: gl::texture::Viewport,
    /// Quaternion describing the view.
    view: [f32; 4],
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
            view: state.camera.get(),
        }
    }

    fn render(self) -> Result<(), wasm_bindgen::JsValue> {
        let mut pipeline = gl::Pipeline::new(&self.ctx);

        let mut meshes = self.mesh.borrow_mut();
        let mut displayfb = gl::texture::EmptyFramebuffer::new(&self.ctx, self.viewport);

        let [w, x, y, z] = self.view;
        let color = gl::UniformData::Scalar(1.0);
        let view = gl::UniformData::Vector4([x, y, z, w]);

        let blues = [("blue", color), ("camera", view)].into_iter().collect();

        self.ctx.disable(gl::GL::CULL_FACE);
        self.ctx.clear_color(0.0, 0.0, 0.0, 0.0);
        self.ctx.clear(gl::GL::COLOR_BUFFER_BIT);

        pipeline.shade(
            &self.program,
            blues,
            meshes.iter_mut().collect(),
            &mut displayfb,
        )?;

        Ok(())
    }
}

const VERTEX_SHADER_SOURCE: &str = r#"#version 100
attribute vec3 in_position;
uniform vec4 camera;

void main() {
  vec3 temp = camera.w * in_position + cross(camera.xyz, in_position);
  gl_Position = vec4(in_position + 2.0 * cross(camera.xyz, temp), 110.0);
}
"#;

const FRAGMENT_SHADER_SOURCE: &str = r#"#version 100
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
