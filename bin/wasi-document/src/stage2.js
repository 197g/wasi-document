// node_modules/@bjorn3/browser_wasi_shim/dist/wasi_defs.js
var CLOCKID_REALTIME = 0;
var CLOCKID_MONOTONIC = 1;
var ERRNO_SUCCESS = 0;
var ERRNO_BADF = 8;
var ERRNO_EXIST = 20;
var ERRNO_INVAL = 28;
var ERRNO_ISDIR = 31;
var ERRNO_NAMETOOLONG = 37;
var ERRNO_NOENT = 44;
var ERRNO_NOSYS = 52;
var ERRNO_NOTDIR = 54;
var ERRNO_NOTEMPTY = 55;
var ERRNO_NOTSUP = 58;
var ERRNO_PERM = 63;
var ERRNO_NOTCAPABLE = 76;
var RIGHTS_FD_DATASYNC = 1 << 0;
var RIGHTS_FD_READ = 1 << 1;
var RIGHTS_FD_SEEK = 1 << 2;
var RIGHTS_FD_FDSTAT_SET_FLAGS = 1 << 3;
var RIGHTS_FD_SYNC = 1 << 4;
var RIGHTS_FD_TELL = 1 << 5;
var RIGHTS_FD_WRITE = 1 << 6;
var RIGHTS_FD_ADVISE = 1 << 7;
var RIGHTS_FD_ALLOCATE = 1 << 8;
var RIGHTS_PATH_CREATE_DIRECTORY = 1 << 9;
var RIGHTS_PATH_CREATE_FILE = 1 << 10;
var RIGHTS_PATH_LINK_SOURCE = 1 << 11;
var RIGHTS_PATH_LINK_TARGET = 1 << 12;
var RIGHTS_PATH_OPEN = 1 << 13;
var RIGHTS_FD_READDIR = 1 << 14;
var RIGHTS_PATH_READLINK = 1 << 15;
var RIGHTS_PATH_RENAME_SOURCE = 1 << 16;
var RIGHTS_PATH_RENAME_TARGET = 1 << 17;
var RIGHTS_PATH_FILESTAT_GET = 1 << 18;
var RIGHTS_PATH_FILESTAT_SET_SIZE = 1 << 19;
var RIGHTS_PATH_FILESTAT_SET_TIMES = 1 << 20;
var RIGHTS_FD_FILESTAT_GET = 1 << 21;
var RIGHTS_FD_FILESTAT_SET_SIZE = 1 << 22;
var RIGHTS_FD_FILESTAT_SET_TIMES = 1 << 23;
var RIGHTS_PATH_SYMLINK = 1 << 24;
var RIGHTS_PATH_REMOVE_DIRECTORY = 1 << 25;
var RIGHTS_PATH_UNLINK_FILE = 1 << 26;
var RIGHTS_POLL_FD_READWRITE = 1 << 27;
var RIGHTS_SOCK_SHUTDOWN = 1 << 28;
var Iovec = class {
  static read_bytes(view, ptr) {
    const iovec = new Iovec();
    iovec.buf = view.getUint32(ptr, true);
    iovec.buf_len = view.getUint32(ptr + 4, true);
    return iovec;
  }
  static read_bytes_array(view, ptr, len) {
    const iovecs = [];
    for (let i = 0; i < len; i++) {
      iovecs.push(Iovec.read_bytes(view, ptr + 8 * i));
    }
    return iovecs;
  }
};
var Ciovec = class {
  static read_bytes(view, ptr) {
    const iovec = new Ciovec();
    iovec.buf = view.getUint32(ptr, true);
    iovec.buf_len = view.getUint32(ptr + 4, true);
    return iovec;
  }
  static read_bytes_array(view, ptr, len) {
    const iovecs = [];
    for (let i = 0; i < len; i++) {
      iovecs.push(Ciovec.read_bytes(view, ptr + 8 * i));
    }
    return iovecs;
  }
};
var WHENCE_SET = 0;
var WHENCE_CUR = 1;
var WHENCE_END = 2;
var FILETYPE_DIRECTORY = 3;
var FILETYPE_REGULAR_FILE = 4;
var Dirent = class {
  head_length() {
    return 24;
  }
  name_length() {
    return this.dir_name.byteLength;
  }
  write_head_bytes(view, ptr) {
    view.setBigUint64(ptr, this.d_next, true);
    view.setBigUint64(ptr + 8, this.d_ino, true);
    view.setUint32(ptr + 16, this.dir_name.length, true);
    view.setUint8(ptr + 20, this.d_type);
  }
  write_name_bytes(view8, ptr, buf_len) {
    view8.set(this.dir_name.slice(0, Math.min(this.dir_name.byteLength, buf_len)), ptr);
  }
  constructor(next_cookie, d_ino, name, type) {
    const encoded_name = new TextEncoder().encode(name);
    this.d_next = next_cookie;
    this.d_ino = d_ino;
    this.d_namlen = encoded_name.byteLength;
    this.d_type = type;
    this.dir_name = encoded_name;
  }
};
var FDFLAGS_APPEND = 1 << 0;
var FDFLAGS_DSYNC = 1 << 1;
var FDFLAGS_NONBLOCK = 1 << 2;
var FDFLAGS_RSYNC = 1 << 3;
var FDFLAGS_SYNC = 1 << 4;
var Fdstat = class {
  write_bytes(view, ptr) {
    view.setUint8(ptr, this.fs_filetype);
    view.setUint16(ptr + 2, this.fs_flags, true);
    view.setBigUint64(ptr + 8, this.fs_rights_base, true);
    view.setBigUint64(ptr + 16, this.fs_rights_inherited, true);
  }
  constructor(filetype, flags) {
    this.fs_rights_base = 0n;
    this.fs_rights_inherited = 0n;
    this.fs_filetype = filetype;
    this.fs_flags = flags;
  }
};
var FSTFLAGS_ATIM = 1 << 0;
var FSTFLAGS_ATIM_NOW = 1 << 1;
var FSTFLAGS_MTIM = 1 << 2;
var FSTFLAGS_MTIM_NOW = 1 << 3;
var OFLAGS_CREAT = 1 << 0;
var OFLAGS_DIRECTORY = 1 << 1;
var OFLAGS_EXCL = 1 << 2;
var OFLAGS_TRUNC = 1 << 3;
var Filestat = class {
  write_bytes(view, ptr) {
    view.setBigUint64(ptr, this.dev, true);
    view.setBigUint64(ptr + 8, this.ino, true);
    view.setUint8(ptr + 16, this.filetype);
    view.setBigUint64(ptr + 24, this.nlink, true);
    view.setBigUint64(ptr + 32, this.size, true);
    view.setBigUint64(ptr + 38, this.atim, true);
    view.setBigUint64(ptr + 46, this.mtim, true);
    view.setBigUint64(ptr + 52, this.ctim, true);
  }
  constructor(ino, filetype, size) {
    this.dev = 0n;
    this.nlink = 0n;
    this.atim = 0n;
    this.mtim = 0n;
    this.ctim = 0n;
    this.ino = ino;
    this.filetype = filetype;
    this.size = size;
  }
};
var EVENTTYPE_CLOCK = 0;
var EVENTRWFLAGS_FD_READWRITE_HANGUP = 1 << 0;
var SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME = 1 << 0;
var Subscription = class {
  static read_bytes(view, ptr) {
    return new Subscription(view.getBigUint64(ptr, true), view.getUint8(ptr + 8), view.getUint32(ptr + 16, true), view.getBigUint64(ptr + 24, true), view.getUint16(ptr + 36, true));
  }
  constructor(userdata, eventtype, clockid, timeout, flags) {
    this.userdata = userdata;
    this.eventtype = eventtype;
    this.clockid = clockid;
    this.timeout = timeout;
    this.flags = flags;
  }
};
var Event = class {
  write_bytes(view, ptr) {
    view.setBigUint64(ptr, this.userdata, true);
    view.setUint16(ptr + 8, this.error, true);
    view.setUint8(ptr + 10, this.eventtype);
  }
  constructor(userdata, error, eventtype) {
    this.userdata = userdata;
    this.error = error;
    this.eventtype = eventtype;
  }
};
var RIFLAGS_RECV_PEEK = 1 << 0;
var RIFLAGS_RECV_WAITALL = 1 << 1;
var ROFLAGS_RECV_DATA_TRUNCATED = 1 << 0;
var SDFLAGS_RD = 1 << 0;
var SDFLAGS_WR = 1 << 1;
var PREOPENTYPE_DIR = 0;
var PrestatDir = class {
  write_bytes(view, ptr) {
    view.setUint32(ptr, this.pr_name.byteLength, true);
  }
  constructor(name) {
    this.pr_name = new TextEncoder().encode(name);
  }
};
var Prestat = class {
  static dir(name) {
    const prestat = new Prestat();
    prestat.tag = PREOPENTYPE_DIR;
    prestat.inner = new PrestatDir(name);
    return prestat;
  }
  write_bytes(view, ptr) {
    view.setUint32(ptr, this.tag, true);
    this.inner.write_bytes(view, ptr + 4);
  }
};

// node_modules/@bjorn3/browser_wasi_shim/dist/debug.js
var Debug = class Debug2 {
  enable(enabled) {
    this.log = createLogger(enabled === void 0 ? true : enabled, this.prefix);
  }
  get enabled() {
    return this.isEnabled;
  }
  constructor(isEnabled) {
    this.isEnabled = isEnabled;
    this.prefix = "wasi:";
    this.enable(isEnabled);
  }
};
function createLogger(enabled, prefix) {
  if (enabled) {
    const a = console.log.bind(console, "%c%s", "color: #265BA0", prefix);
    return a;
  } else {
    return () => {
    };
  }
}
var debug = new Debug(false);

// node_modules/@bjorn3/browser_wasi_shim/dist/wasi.js
var WASIProcExit = class extends Error {
  constructor(code) {
    super("exit with exit code " + code);
    this.code = code;
  }
};
var WASI = class WASI2 {
  start(instance) {
    this.inst = instance;
    try {
      instance.exports._start();
      return 0;
    } catch (e) {
      if (e instanceof WASIProcExit) {
        return e.code;
      } else {
        throw e;
      }
    }
  }
  initialize(instance) {
    this.inst = instance;
    if (instance.exports._initialize) {
      instance.exports._initialize();
    }
  }
  constructor(args, env, fds, options = {}) {
    this.args = [];
    this.env = [];
    this.fds = [];
    debug.enable(options.debug);
    this.args = args;
    this.env = env;
    this.fds = fds;
    const self2 = this;
    this.wasiImport = { args_sizes_get(argc, argv_buf_size) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      buffer.setUint32(argc, self2.args.length, true);
      let buf_size = 0;
      for (const arg of self2.args) {
        buf_size += arg.length + 1;
      }
      buffer.setUint32(argv_buf_size, buf_size, true);
      debug.log(buffer.getUint32(argc, true), buffer.getUint32(argv_buf_size, true));
      return 0;
    }, args_get(argv, argv_buf) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      const orig_argv_buf = argv_buf;
      for (let i = 0; i < self2.args.length; i++) {
        buffer.setUint32(argv, argv_buf, true);
        argv += 4;
        const arg = new TextEncoder().encode(self2.args[i]);
        buffer8.set(arg, argv_buf);
        buffer.setUint8(argv_buf + arg.length, 0);
        argv_buf += arg.length + 1;
      }
      if (debug.enabled) {
        debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_argv_buf, argv_buf)));
      }
      return 0;
    }, environ_sizes_get(environ_count, environ_size) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      buffer.setUint32(environ_count, self2.env.length, true);
      let buf_size = 0;
      for (const environ of self2.env) {
        buf_size += new TextEncoder().encode(environ).length + 1;
      }
      buffer.setUint32(environ_size, buf_size, true);
      debug.log(buffer.getUint32(environ_count, true), buffer.getUint32(environ_size, true));
      return 0;
    }, environ_get(environ, environ_buf) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      const orig_environ_buf = environ_buf;
      for (let i = 0; i < self2.env.length; i++) {
        buffer.setUint32(environ, environ_buf, true);
        environ += 4;
        const e = new TextEncoder().encode(self2.env[i]);
        buffer8.set(e, environ_buf);
        buffer.setUint8(environ_buf + e.length, 0);
        environ_buf += e.length + 1;
      }
      if (debug.enabled) {
        debug.log(new TextDecoder("utf-8").decode(buffer8.slice(orig_environ_buf, environ_buf)));
      }
      return 0;
    }, clock_res_get(id, res_ptr) {
      let resolutionValue;
      switch (id) {
        case CLOCKID_MONOTONIC: {
          resolutionValue = 5000n;
          break;
        }
        case CLOCKID_REALTIME: {
          resolutionValue = 1000000n;
          break;
        }
        default:
          return ERRNO_NOSYS;
      }
      const view = new DataView(self2.inst.exports.memory.buffer);
      view.setBigUint64(res_ptr, resolutionValue, true);
      return ERRNO_SUCCESS;
    }, clock_time_get(id, precision, time) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      if (id === CLOCKID_REALTIME) {
        buffer.setBigUint64(time, BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n, true);
      } else if (id == CLOCKID_MONOTONIC) {
        let monotonic_time;
        try {
          monotonic_time = BigInt(Math.round(performance.now() * 1e6));
        } catch (e) {
          monotonic_time = 0n;
        }
        buffer.setBigUint64(time, monotonic_time, true);
      } else {
        buffer.setBigUint64(time, 0n, true);
      }
      return 0;
    }, fd_advise(fd, offset, len, advice) {
      if (self2.fds[fd] != void 0) {
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_allocate(fd, offset, len) {
      if (self2.fds[fd] != void 0) {
        return self2.fds[fd].fd_allocate(offset, len);
      } else {
        return ERRNO_BADF;
      }
    }, fd_close(fd) {
      if (self2.fds[fd] != void 0) {
        const ret = self2.fds[fd].fd_close();
        self2.fds[fd] = void 0;
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_datasync(fd) {
      if (self2.fds[fd] != void 0) {
        return self2.fds[fd].fd_sync();
      } else {
        return ERRNO_BADF;
      }
    }, fd_fdstat_get(fd, fdstat_ptr) {
      if (self2.fds[fd] != void 0) {
        const { ret, fdstat } = self2.fds[fd].fd_fdstat_get();
        if (fdstat != null) {
          fdstat.write_bytes(new DataView(self2.inst.exports.memory.buffer), fdstat_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_fdstat_set_flags(fd, flags) {
      if (self2.fds[fd] != void 0) {
        return self2.fds[fd].fd_fdstat_set_flags(flags);
      } else {
        return ERRNO_BADF;
      }
    }, fd_fdstat_set_rights(fd, fs_rights_base, fs_rights_inheriting) {
      if (self2.fds[fd] != void 0) {
        return self2.fds[fd].fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting);
      } else {
        return ERRNO_BADF;
      }
    }, fd_filestat_get(fd, filestat_ptr) {
      if (self2.fds[fd] != void 0) {
        const { ret, filestat } = self2.fds[fd].fd_filestat_get();
        if (filestat != null) {
          filestat.write_bytes(new DataView(self2.inst.exports.memory.buffer), filestat_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_filestat_set_size(fd, size) {
      if (self2.fds[fd] != void 0) {
        return self2.fds[fd].fd_filestat_set_size(size);
      } else {
        return ERRNO_BADF;
      }
    }, fd_filestat_set_times(fd, atim, mtim, fst_flags) {
      if (self2.fds[fd] != void 0) {
        return self2.fds[fd].fd_filestat_set_times(atim, mtim, fst_flags);
      } else {
        return ERRNO_BADF;
      }
    }, fd_pread(fd, iovs_ptr, iovs_len, offset, nread_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nread = 0;
        for (const iovec of iovecs) {
          const { ret, data } = self2.fds[fd].fd_pread(iovec.buf_len, offset);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nread_ptr, nread, true);
            return ret;
          }
          buffer8.set(data, iovec.buf);
          nread += data.length;
          offset += BigInt(data.length);
          if (data.length != iovec.buf_len) {
            break;
          }
        }
        buffer.setUint32(nread_ptr, nread, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_prestat_get(fd, buf_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const { ret, prestat } = self2.fds[fd].fd_prestat_get();
        if (prestat != null) {
          prestat.write_bytes(buffer, buf_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_prestat_dir_name(fd, path_ptr, path_len) {
      if (self2.fds[fd] != void 0) {
        const { ret, prestat } = self2.fds[fd].fd_prestat_get();
        if (prestat == null) {
          return ret;
        }
        const prestat_dir_name = prestat.inner.pr_name;
        const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
        buffer8.set(prestat_dir_name.slice(0, path_len), path_ptr);
        return prestat_dir_name.byteLength > path_len ? ERRNO_NAMETOOLONG : ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_pwrite(fd, iovs_ptr, iovs_len, offset, nwritten_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nwritten = 0;
        for (const iovec of iovecs) {
          const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
          const { ret, nwritten: nwritten_part } = self2.fds[fd].fd_pwrite(data, offset);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nwritten_ptr, nwritten, true);
            return ret;
          }
          nwritten += nwritten_part;
          offset += BigInt(nwritten_part);
          if (nwritten_part != data.byteLength) {
            break;
          }
        }
        buffer.setUint32(nwritten_ptr, nwritten, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_read(fd, iovs_ptr, iovs_len, nread_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nread = 0;
        for (const iovec of iovecs) {
          const { ret, data } = self2.fds[fd].fd_read(iovec.buf_len);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nread_ptr, nread, true);
            return ret;
          }
          buffer8.set(data, iovec.buf);
          nread += data.length;
          if (data.length != iovec.buf_len) {
            break;
          }
        }
        buffer.setUint32(nread_ptr, nread, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, fd_readdir(fd, buf, buf_len, cookie, bufused_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        let bufused = 0;
        while (true) {
          const { ret, dirent } = self2.fds[fd].fd_readdir_single(cookie);
          if (ret != 0) {
            buffer.setUint32(bufused_ptr, bufused, true);
            return ret;
          }
          if (dirent == null) {
            break;
          }
          if (buf_len - bufused < dirent.head_length()) {
            bufused = buf_len;
            break;
          }
          const head_bytes = new ArrayBuffer(dirent.head_length());
          dirent.write_head_bytes(new DataView(head_bytes), 0);
          buffer8.set(new Uint8Array(head_bytes).slice(0, Math.min(head_bytes.byteLength, buf_len - bufused)), buf);
          buf += dirent.head_length();
          bufused += dirent.head_length();
          if (buf_len - bufused < dirent.name_length()) {
            bufused = buf_len;
            break;
          }
          dirent.write_name_bytes(buffer8, buf, buf_len - bufused);
          buf += dirent.name_length();
          bufused += dirent.name_length();
          cookie = dirent.d_next;
        }
        buffer.setUint32(bufused_ptr, bufused, true);
        return 0;
      } else {
        return ERRNO_BADF;
      }
    }, fd_renumber(fd, to) {
      if (self2.fds[fd] != void 0 && self2.fds[to] != void 0) {
        const ret = self2.fds[to].fd_close();
        if (ret != 0) {
          return ret;
        }
        self2.fds[to] = self2.fds[fd];
        self2.fds[fd] = void 0;
        return 0;
      } else {
        return ERRNO_BADF;
      }
    }, fd_seek(fd, offset, whence, offset_out_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const { ret, offset: offset_out } = self2.fds[fd].fd_seek(offset, whence);
        buffer.setBigInt64(offset_out_ptr, offset_out, true);
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_sync(fd) {
      if (self2.fds[fd] != void 0) {
        return self2.fds[fd].fd_sync();
      } else {
        return ERRNO_BADF;
      }
    }, fd_tell(fd, offset_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const { ret, offset } = self2.fds[fd].fd_tell();
        buffer.setBigUint64(offset_ptr, offset, true);
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
        let nwritten = 0;
        for (const iovec of iovecs) {
          const data = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
          const { ret, nwritten: nwritten_part } = self2.fds[fd].fd_write(data);
          if (ret != ERRNO_SUCCESS) {
            buffer.setUint32(nwritten_ptr, nwritten, true);
            return ret;
          }
          nwritten += nwritten_part;
          if (nwritten_part != data.byteLength) {
            break;
          }
        }
        buffer.setUint32(nwritten_ptr, nwritten, true);
        return ERRNO_SUCCESS;
      } else {
        return ERRNO_BADF;
      }
    }, path_create_directory(fd, path_ptr, path_len) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self2.fds[fd].path_create_directory(path);
      } else {
        return ERRNO_BADF;
      }
    }, path_filestat_get(fd, flags, path_ptr, path_len, filestat_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        const { ret, filestat } = self2.fds[fd].path_filestat_get(flags, path);
        if (filestat != null) {
          filestat.write_bytes(buffer, filestat_ptr);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, path_filestat_set_times(fd, flags, path_ptr, path_len, atim, mtim, fst_flags) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self2.fds[fd].path_filestat_set_times(flags, path, atim, mtim, fst_flags);
      } else {
        return ERRNO_BADF;
      }
    }, path_link(old_fd, old_flags, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[old_fd] != void 0 && self2.fds[new_fd] != void 0) {
        const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
        const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
        const { ret, inode_obj } = self2.fds[old_fd].path_lookup(old_path, old_flags);
        if (inode_obj == null) {
          return ret;
        }
        return self2.fds[new_fd].path_link(new_path, inode_obj, false);
      } else {
        return ERRNO_BADF;
      }
    }, path_open(fd, dirflags, path_ptr, path_len, oflags, fs_rights_base, fs_rights_inheriting, fd_flags, opened_fd_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        debug.log(path);
        const { ret, fd_obj } = self2.fds[fd].path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags);
        if (ret != 0) {
          return ret;
        }
        self2.fds.push(fd_obj);
        const opened_fd = self2.fds.length - 1;
        buffer.setUint32(opened_fd_ptr, opened_fd, true);
        return 0;
      } else {
        return ERRNO_BADF;
      }
    }, path_readlink(fd, path_ptr, path_len, buf_ptr, buf_len, nread_ptr) {
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        debug.log(path);
        const { ret, data } = self2.fds[fd].path_readlink(path);
        if (data != null) {
          const data_buf = new TextEncoder().encode(data);
          if (data_buf.length > buf_len) {
            buffer.setUint32(nread_ptr, 0, true);
            return ERRNO_BADF;
          }
          buffer8.set(data_buf, buf_ptr);
          buffer.setUint32(nread_ptr, data_buf.length, true);
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, path_remove_directory(fd, path_ptr, path_len) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self2.fds[fd].path_remove_directory(path);
      } else {
        return ERRNO_BADF;
      }
    }, path_rename(fd, old_path_ptr, old_path_len, new_fd, new_path_ptr, new_path_len) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0 && self2.fds[new_fd] != void 0) {
        const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
        const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
        let { ret, inode_obj } = self2.fds[fd].path_unlink(old_path);
        if (inode_obj == null) {
          return ret;
        }
        ret = self2.fds[new_fd].path_link(new_path, inode_obj, true);
        if (ret != ERRNO_SUCCESS) {
          if (self2.fds[fd].path_link(old_path, inode_obj, true) != ERRNO_SUCCESS) {
            throw "path_link should always return success when relinking an inode back to the original place";
          }
        }
        return ret;
      } else {
        return ERRNO_BADF;
      }
    }, path_symlink(old_path_ptr, old_path_len, fd, new_path_ptr, new_path_len) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const old_path = new TextDecoder("utf-8").decode(buffer8.slice(old_path_ptr, old_path_ptr + old_path_len));
        const new_path = new TextDecoder("utf-8").decode(buffer8.slice(new_path_ptr, new_path_ptr + new_path_len));
        return ERRNO_NOTSUP;
      } else {
        return ERRNO_BADF;
      }
    }, path_unlink_file(fd, path_ptr, path_len) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer);
      if (self2.fds[fd] != void 0) {
        const path = new TextDecoder("utf-8").decode(buffer8.slice(path_ptr, path_ptr + path_len));
        return self2.fds[fd].path_unlink_file(path);
      } else {
        return ERRNO_BADF;
      }
    }, poll_oneoff(in_ptr, out_ptr, nsubscriptions) {
      if (nsubscriptions === 0) {
        return ERRNO_INVAL;
      }
      if (nsubscriptions > 1) {
        debug.log("poll_oneoff: only a single subscription is supported");
        return ERRNO_NOTSUP;
      }
      const buffer = new DataView(self2.inst.exports.memory.buffer);
      const s = Subscription.read_bytes(buffer, in_ptr);
      const eventtype = s.eventtype;
      const clockid = s.clockid;
      const timeout = s.timeout;
      if (eventtype !== EVENTTYPE_CLOCK) {
        debug.log("poll_oneoff: only clock subscriptions are supported");
        return ERRNO_NOTSUP;
      }
      let getNow = void 0;
      if (clockid === CLOCKID_MONOTONIC) {
        getNow = () => BigInt(Math.round(performance.now() * 1e6));
      } else if (clockid === CLOCKID_REALTIME) {
        getNow = () => BigInt((/* @__PURE__ */ new Date()).getTime()) * 1000000n;
      } else {
        return ERRNO_INVAL;
      }
      const endTime = (s.flags & SUBCLOCKFLAGS_SUBSCRIPTION_CLOCK_ABSTIME) !== 0 ? timeout : getNow() + timeout;
      while (endTime > getNow()) {
      }
      const event2 = new Event(s.userdata, ERRNO_SUCCESS, eventtype);
      event2.write_bytes(buffer, out_ptr);
      return ERRNO_SUCCESS;
    }, proc_exit(exit_code) {
      throw new WASIProcExit(exit_code);
    }, proc_raise(sig) {
      throw "raised signal " + sig;
    }, sched_yield() {
    }, random_get(buf, buf_len) {
      const buffer8 = new Uint8Array(self2.inst.exports.memory.buffer).subarray(buf, buf + buf_len);
      if ("crypto" in globalThis && (typeof SharedArrayBuffer === "undefined" || !(self2.inst.exports.memory.buffer instanceof SharedArrayBuffer))) {
        for (let i = 0; i < buf_len; i += 65536) {
          crypto.getRandomValues(buffer8.subarray(i, i + 65536));
        }
      } else {
        for (let i = 0; i < buf_len; i++) {
          buffer8[i] = Math.random() * 256 | 0;
        }
      }
    }, sock_recv(fd, ri_data, ri_flags) {
      throw "sockets not supported";
    }, sock_send(fd, si_data, si_flags) {
      throw "sockets not supported";
    }, sock_shutdown(fd, how) {
      throw "sockets not supported";
    }, sock_accept(fd, flags) {
      throw "sockets not supported";
    } };
  }
};

// node_modules/@bjorn3/browser_wasi_shim/dist/fd.js
var Fd = class {
  fd_allocate(offset, len) {
    return ERRNO_NOTSUP;
  }
  fd_close() {
    return 0;
  }
  fd_fdstat_get() {
    return { ret: ERRNO_NOTSUP, fdstat: null };
  }
  fd_fdstat_set_flags(flags) {
    return ERRNO_NOTSUP;
  }
  fd_fdstat_set_rights(fs_rights_base, fs_rights_inheriting) {
    return ERRNO_NOTSUP;
  }
  fd_filestat_get() {
    return { ret: ERRNO_NOTSUP, filestat: null };
  }
  fd_filestat_set_size(size) {
    return ERRNO_NOTSUP;
  }
  fd_filestat_set_times(atim, mtim, fst_flags) {
    return ERRNO_NOTSUP;
  }
  fd_pread(size, offset) {
    return { ret: ERRNO_NOTSUP, data: new Uint8Array() };
  }
  fd_prestat_get() {
    return { ret: ERRNO_NOTSUP, prestat: null };
  }
  fd_pwrite(data, offset) {
    return { ret: ERRNO_NOTSUP, nwritten: 0 };
  }
  fd_read(size) {
    return { ret: ERRNO_NOTSUP, data: new Uint8Array() };
  }
  fd_readdir_single(cookie) {
    return { ret: ERRNO_NOTSUP, dirent: null };
  }
  fd_seek(offset, whence) {
    return { ret: ERRNO_NOTSUP, offset: 0n };
  }
  fd_sync() {
    return 0;
  }
  fd_tell() {
    return { ret: ERRNO_NOTSUP, offset: 0n };
  }
  fd_write(data) {
    return { ret: ERRNO_NOTSUP, nwritten: 0 };
  }
  path_create_directory(path) {
    return ERRNO_NOTSUP;
  }
  path_filestat_get(flags, path) {
    return { ret: ERRNO_NOTSUP, filestat: null };
  }
  path_filestat_set_times(flags, path, atim, mtim, fst_flags) {
    return ERRNO_NOTSUP;
  }
  path_link(path, inode, allow_dir) {
    return ERRNO_NOTSUP;
  }
  path_unlink(path) {
    return { ret: ERRNO_NOTSUP, inode_obj: null };
  }
  path_lookup(path, dirflags) {
    return { ret: ERRNO_NOTSUP, inode_obj: null };
  }
  path_open(dirflags, path, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
    return { ret: ERRNO_NOTDIR, fd_obj: null };
  }
  path_readlink(path) {
    return { ret: ERRNO_NOTSUP, data: null };
  }
  path_remove_directory(path) {
    return ERRNO_NOTSUP;
  }
  path_rename(old_path, new_fd, new_path) {
    return ERRNO_NOTSUP;
  }
  path_unlink_file(path) {
    return ERRNO_NOTSUP;
  }
};
var Inode = class {
  static issue_ino() {
    return Inode.next_ino++;
  }
  static root_ino() {
    return 0n;
  }
  constructor() {
    this.ino = Inode.issue_ino();
  }
};
Inode.next_ino = 1n;

// node_modules/@bjorn3/browser_wasi_shim/dist/fs_mem.js
var OpenFile = class extends Fd {
  fd_allocate(offset, len) {
    if (this.file.size > offset + len) {
    } else {
      const new_data = new Uint8Array(Number(offset + len));
      new_data.set(this.file.data, 0);
      this.file.data = new_data;
    }
    return ERRNO_SUCCESS;
  }
  fd_fdstat_get() {
    return { ret: 0, fdstat: new Fdstat(FILETYPE_REGULAR_FILE, 0) };
  }
  fd_filestat_set_size(size) {
    if (this.file.size > size) {
      this.file.data = new Uint8Array(this.file.data.buffer.slice(0, Number(size)));
    } else {
      const new_data = new Uint8Array(Number(size));
      new_data.set(this.file.data, 0);
      this.file.data = new_data;
    }
    return ERRNO_SUCCESS;
  }
  fd_read(size) {
    const slice = this.file.data.slice(Number(this.file_pos), Number(this.file_pos + BigInt(size)));
    this.file_pos += BigInt(slice.length);
    return { ret: 0, data: slice };
  }
  fd_pread(size, offset) {
    const slice = this.file.data.slice(Number(offset), Number(offset + BigInt(size)));
    return { ret: 0, data: slice };
  }
  fd_seek(offset, whence) {
    let calculated_offset;
    switch (whence) {
      case WHENCE_SET:
        calculated_offset = offset;
        break;
      case WHENCE_CUR:
        calculated_offset = this.file_pos + offset;
        break;
      case WHENCE_END:
        calculated_offset = BigInt(this.file.data.byteLength) + offset;
        break;
      default:
        return { ret: ERRNO_INVAL, offset: 0n };
    }
    if (calculated_offset < 0) {
      return { ret: ERRNO_INVAL, offset: 0n };
    }
    this.file_pos = calculated_offset;
    return { ret: 0, offset: this.file_pos };
  }
  fd_tell() {
    return { ret: 0, offset: this.file_pos };
  }
  fd_write(data) {
    if (this.file.readonly)
      return { ret: ERRNO_BADF, nwritten: 0 };
    if (this.file_pos + BigInt(data.byteLength) > this.file.size) {
      const old = this.file.data;
      this.file.data = new Uint8Array(Number(this.file_pos + BigInt(data.byteLength)));
      this.file.data.set(old);
    }
    this.file.data.set(data, Number(this.file_pos));
    this.file_pos += BigInt(data.byteLength);
    return { ret: 0, nwritten: data.byteLength };
  }
  fd_pwrite(data, offset) {
    if (this.file.readonly)
      return { ret: ERRNO_BADF, nwritten: 0 };
    if (offset + BigInt(data.byteLength) > this.file.size) {
      const old = this.file.data;
      this.file.data = new Uint8Array(Number(offset + BigInt(data.byteLength)));
      this.file.data.set(old);
    }
    this.file.data.set(data, Number(offset));
    return { ret: 0, nwritten: data.byteLength };
  }
  fd_filestat_get() {
    return { ret: 0, filestat: this.file.stat() };
  }
  constructor(file) {
    super();
    this.file_pos = 0n;
    this.file = file;
  }
};
var OpenDirectory = class extends Fd {
  fd_seek(offset, whence) {
    return { ret: ERRNO_BADF, offset: 0n };
  }
  fd_tell() {
    return { ret: ERRNO_BADF, offset: 0n };
  }
  fd_allocate(offset, len) {
    return ERRNO_BADF;
  }
  fd_fdstat_get() {
    return { ret: 0, fdstat: new Fdstat(FILETYPE_DIRECTORY, 0) };
  }
  fd_readdir_single(cookie) {
    if (debug.enabled) {
      debug.log("readdir_single", cookie);
      debug.log(cookie, this.dir.contents.keys());
    }
    if (cookie == 0n) {
      return { ret: ERRNO_SUCCESS, dirent: new Dirent(1n, this.dir.ino, ".", FILETYPE_DIRECTORY) };
    } else if (cookie == 1n) {
      return { ret: ERRNO_SUCCESS, dirent: new Dirent(2n, this.dir.parent_ino(), "..", FILETYPE_DIRECTORY) };
    }
    if (cookie >= BigInt(this.dir.contents.size) + 2n) {
      return { ret: 0, dirent: null };
    }
    const [name, entry] = Array.from(this.dir.contents.entries())[Number(cookie - 2n)];
    return { ret: 0, dirent: new Dirent(cookie + 1n, entry.ino, name, entry.stat().filetype) };
  }
  path_filestat_get(flags, path_str) {
    const { ret: path_err, path } = Path.from(path_str);
    if (path == null) {
      return { ret: path_err, filestat: null };
    }
    const { ret, entry } = this.dir.get_entry_for_path(path);
    if (entry == null) {
      return { ret, filestat: null };
    }
    return { ret: 0, filestat: entry.stat() };
  }
  path_lookup(path_str, dirflags) {
    const { ret: path_ret, path } = Path.from(path_str);
    if (path == null) {
      return { ret: path_ret, inode_obj: null };
    }
    const { ret, entry } = this.dir.get_entry_for_path(path);
    if (entry == null) {
      return { ret, inode_obj: null };
    }
    return { ret: ERRNO_SUCCESS, inode_obj: entry };
  }
  path_open(dirflags, path_str, oflags, fs_rights_base, fs_rights_inheriting, fd_flags) {
    const { ret: path_ret, path } = Path.from(path_str);
    if (path == null) {
      return { ret: path_ret, fd_obj: null };
    }
    let { ret, entry } = this.dir.get_entry_for_path(path);
    if (entry == null) {
      if (ret != ERRNO_NOENT) {
        return { ret, fd_obj: null };
      }
      if ((oflags & OFLAGS_CREAT) == OFLAGS_CREAT) {
        const { ret: ret2, entry: new_entry } = this.dir.create_entry_for_path(path_str, (oflags & OFLAGS_DIRECTORY) == OFLAGS_DIRECTORY);
        if (new_entry == null) {
          return { ret: ret2, fd_obj: null };
        }
        entry = new_entry;
      } else {
        return { ret: ERRNO_NOENT, fd_obj: null };
      }
    } else if ((oflags & OFLAGS_EXCL) == OFLAGS_EXCL) {
      return { ret: ERRNO_EXIST, fd_obj: null };
    }
    if ((oflags & OFLAGS_DIRECTORY) == OFLAGS_DIRECTORY && entry.stat().filetype !== FILETYPE_DIRECTORY) {
      return { ret: ERRNO_NOTDIR, fd_obj: null };
    }
    return entry.path_open(oflags, fs_rights_base, fd_flags);
  }
  path_create_directory(path) {
    return this.path_open(0, path, OFLAGS_CREAT | OFLAGS_DIRECTORY, 0n, 0n, 0).ret;
  }
  path_link(path_str, inode, allow_dir) {
    const { ret: path_ret, path } = Path.from(path_str);
    if (path == null) {
      return path_ret;
    }
    if (path.is_dir) {
      return ERRNO_NOENT;
    }
    const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, true);
    if (parent_entry == null || filename == null) {
      return parent_ret;
    }
    if (entry != null) {
      const source_is_dir = inode.stat().filetype == FILETYPE_DIRECTORY;
      const target_is_dir = entry.stat().filetype == FILETYPE_DIRECTORY;
      if (source_is_dir && target_is_dir) {
        if (allow_dir && entry instanceof Directory) {
          if (entry.contents.size == 0) {
          } else {
            return ERRNO_NOTEMPTY;
          }
        } else {
          return ERRNO_EXIST;
        }
      } else if (source_is_dir && !target_is_dir) {
        return ERRNO_NOTDIR;
      } else if (!source_is_dir && target_is_dir) {
        return ERRNO_ISDIR;
      } else if (inode.stat().filetype == FILETYPE_REGULAR_FILE && entry.stat().filetype == FILETYPE_REGULAR_FILE) {
      } else {
        return ERRNO_EXIST;
      }
    }
    if (!allow_dir && inode.stat().filetype == FILETYPE_DIRECTORY) {
      return ERRNO_PERM;
    }
    parent_entry.contents.set(filename, inode);
    return ERRNO_SUCCESS;
  }
  path_unlink(path_str) {
    const { ret: path_ret, path } = Path.from(path_str);
    if (path == null) {
      return { ret: path_ret, inode_obj: null };
    }
    const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, true);
    if (parent_entry == null || filename == null) {
      return { ret: parent_ret, inode_obj: null };
    }
    if (entry == null) {
      return { ret: ERRNO_NOENT, inode_obj: null };
    }
    parent_entry.contents.delete(filename);
    return { ret: ERRNO_SUCCESS, inode_obj: entry };
  }
  path_unlink_file(path_str) {
    const { ret: path_ret, path } = Path.from(path_str);
    if (path == null) {
      return path_ret;
    }
    const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, false);
    if (parent_entry == null || filename == null || entry == null) {
      return parent_ret;
    }
    if (entry.stat().filetype === FILETYPE_DIRECTORY) {
      return ERRNO_ISDIR;
    }
    parent_entry.contents.delete(filename);
    return ERRNO_SUCCESS;
  }
  path_remove_directory(path_str) {
    const { ret: path_ret, path } = Path.from(path_str);
    if (path == null) {
      return path_ret;
    }
    const { ret: parent_ret, parent_entry, filename, entry } = this.dir.get_parent_dir_and_entry_for_path(path, false);
    if (parent_entry == null || filename == null || entry == null) {
      return parent_ret;
    }
    if (!(entry instanceof Directory) || entry.stat().filetype !== FILETYPE_DIRECTORY) {
      return ERRNO_NOTDIR;
    }
    if (entry.contents.size !== 0) {
      return ERRNO_NOTEMPTY;
    }
    if (!parent_entry.contents.delete(filename)) {
      return ERRNO_NOENT;
    }
    return ERRNO_SUCCESS;
  }
  fd_filestat_get() {
    return { ret: 0, filestat: this.dir.stat() };
  }
  fd_filestat_set_size(size) {
    return ERRNO_BADF;
  }
  fd_read(size) {
    return { ret: ERRNO_BADF, data: new Uint8Array() };
  }
  fd_pread(size, offset) {
    return { ret: ERRNO_BADF, data: new Uint8Array() };
  }
  fd_write(data) {
    return { ret: ERRNO_BADF, nwritten: 0 };
  }
  fd_pwrite(data, offset) {
    return { ret: ERRNO_BADF, nwritten: 0 };
  }
  constructor(dir) {
    super();
    this.dir = dir;
  }
};
var PreopenDirectory = class extends OpenDirectory {
  fd_prestat_get() {
    return { ret: 0, prestat: Prestat.dir(this.prestat_name) };
  }
  constructor(name, contents) {
    super(new Directory(contents));
    this.prestat_name = name;
  }
};
var File = class extends Inode {
  path_open(oflags, fs_rights_base, fd_flags) {
    if (this.readonly && (fs_rights_base & BigInt(RIGHTS_FD_WRITE)) == BigInt(RIGHTS_FD_WRITE)) {
      return { ret: ERRNO_PERM, fd_obj: null };
    }
    if ((oflags & OFLAGS_TRUNC) == OFLAGS_TRUNC) {
      if (this.readonly)
        return { ret: ERRNO_PERM, fd_obj: null };
      this.data = new Uint8Array([]);
    }
    const file = new OpenFile(this);
    if (fd_flags & FDFLAGS_APPEND)
      file.fd_seek(0n, WHENCE_END);
    return { ret: ERRNO_SUCCESS, fd_obj: file };
  }
  get size() {
    return BigInt(this.data.byteLength);
  }
  stat() {
    return new Filestat(this.ino, FILETYPE_REGULAR_FILE, this.size);
  }
  constructor(data, options) {
    super();
    this.data = new Uint8Array(data);
    this.readonly = !!options?.readonly;
  }
};
var Path = class Path2 {
  static from(path) {
    const self2 = new Path2();
    self2.is_dir = path.endsWith("/");
    if (path.startsWith("/")) {
      return { ret: ERRNO_NOTCAPABLE, path: null };
    }
    if (path.includes("\0")) {
      return { ret: ERRNO_INVAL, path: null };
    }
    for (const component of path.split("/")) {
      if (component === "" || component === ".") {
        continue;
      }
      if (component === "..") {
        if (self2.parts.pop() == void 0) {
          return { ret: ERRNO_NOTCAPABLE, path: null };
        }
        continue;
      }
      self2.parts.push(component);
    }
    return { ret: ERRNO_SUCCESS, path: self2 };
  }
  to_path_string() {
    let s = this.parts.join("/");
    if (this.is_dir) {
      s += "/";
    }
    return s;
  }
  constructor() {
    this.parts = [];
    this.is_dir = false;
  }
};
var Directory = class extends Inode {
  parent_ino() {
    if (this.parent == null) {
      return Inode.root_ino();
    }
    return this.parent.ino;
  }
  path_open(oflags, fs_rights_base, fd_flags) {
    return { ret: ERRNO_SUCCESS, fd_obj: new OpenDirectory(this) };
  }
  stat() {
    return new Filestat(this.ino, FILETYPE_DIRECTORY, 0n);
  }
  get_entry_for_path(path) {
    let entry = this;
    for (const component of path.parts) {
      if (!(entry instanceof Directory)) {
        return { ret: ERRNO_NOTDIR, entry: null };
      }
      const child = entry.contents.get(component);
      if (child !== void 0) {
        entry = child;
      } else {
        debug.log(component);
        return { ret: ERRNO_NOENT, entry: null };
      }
    }
    if (path.is_dir) {
      if (entry.stat().filetype != FILETYPE_DIRECTORY) {
        return { ret: ERRNO_NOTDIR, entry: null };
      }
    }
    return { ret: ERRNO_SUCCESS, entry };
  }
  get_parent_dir_and_entry_for_path(path, allow_undefined) {
    const filename = path.parts.pop();
    if (filename === void 0) {
      return { ret: ERRNO_INVAL, parent_entry: null, filename: null, entry: null };
    }
    const { ret: entry_ret, entry: parent_entry } = this.get_entry_for_path(path);
    if (parent_entry == null) {
      return { ret: entry_ret, parent_entry: null, filename: null, entry: null };
    }
    if (!(parent_entry instanceof Directory)) {
      return { ret: ERRNO_NOTDIR, parent_entry: null, filename: null, entry: null };
    }
    const entry = parent_entry.contents.get(filename);
    if (entry === void 0) {
      if (!allow_undefined) {
        return { ret: ERRNO_NOENT, parent_entry: null, filename: null, entry: null };
      } else {
        return { ret: ERRNO_SUCCESS, parent_entry, filename, entry: null };
      }
    }
    if (path.is_dir) {
      if (entry.stat().filetype != FILETYPE_DIRECTORY) {
        return { ret: ERRNO_NOTDIR, parent_entry: null, filename: null, entry: null };
      }
    }
    return { ret: ERRNO_SUCCESS, parent_entry, filename, entry };
  }
  create_entry_for_path(path_str, is_dir) {
    const { ret: path_ret, path } = Path.from(path_str);
    if (path == null) {
      return { ret: path_ret, entry: null };
    }
    let { ret: parent_ret, parent_entry, filename, entry } = this.get_parent_dir_and_entry_for_path(path, true);
    if (parent_entry == null || filename == null) {
      return { ret: parent_ret, entry: null };
    }
    if (entry != null) {
      return { ret: ERRNO_EXIST, entry: null };
    }
    debug.log("create", path);
    let new_child;
    if (!is_dir) {
      new_child = new File(new ArrayBuffer(0));
    } else {
      new_child = new Directory(/* @__PURE__ */ new Map());
    }
    parent_entry.contents.set(filename, new_child);
    entry = new_child;
    return { ret: ERRNO_SUCCESS, entry };
  }
  constructor(contents) {
    super();
    this.parent = null;
    if (contents instanceof Array) {
      this.contents = new Map(contents);
    } else {
      this.contents = contents;
    }
    for (const entry of this.contents.values()) {
      if (entry instanceof Directory) {
        entry.parent = this;
      }
    }
  }
};

// wasi-interpreter-ns:wasi-config:config.toml.mjs
async function load_config() {
  const data = "2,0,0,0,2,0,0,0,248,3,0,0,19,0,0,0,13,0,0,0,1,0,0,0,0,1,0,0,4,0,0,0,1,0,0,0,0,0,0,0,6,0,0,0,2,0,0,0,1,1,0,0,2,1,0,0,8,0,0,0,1,0,0,0,3,1,0,0,2,0,0,0,2,0,0,0,11,4,0,0,4,0,0,0,6,0,0,0,2,0,0,0,0,0,0,0,5,1,0,0,8,0,0,0,1,0,0,0,6,1,0,0,2,0,0,0,2,0,0,0,15,4,0,0,3,0,0,0,6,0,0,0,2,0,0,0,0,0,0,0,8,1,0,0,2,0,0,0,2,0,0,0,18,4,0,0,4,0,0,0,14,0,0,0,0,0,0,0,7,0,0,0,3,0,0,0,11,1,0,0,10,1,0,0,4,1,0,0,9,0,0,0,1,0,0,0,11,1,0,0,2,0,0,0,2,0,0,0,22,4,0,0,4,0,0,0,14,0,0,0,0,0,0,0,7,0,0,0,3,0,0,0,15,1,0,0,14,1,0,0,7,1,0,0,9,0,0,0,1,0,0,0,15,1,0,0,14,0,0,0,0,0,0,0,14,0,0,0,0,0,0,0,2,0,0,0,2,0,0,0,26,4,0,0,1,0,0,0,2,0,0,0,2,0,0,0,27,4,0,0,1,0,0,0,2,0,0,0,2,0,0,0,28,4,0,0,1,0,0,0,2,0,0,0,2,0,0,0,29,4,0,0,3,0,0,0,2,0,0,0,2,0,0,0,32,4,0,0,2,0,0,0,2,0,0,0,2,0,0,0,34,4,0,0,4,0,0,0,4,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,1,0,0,0,26,1,0,0,4,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,1,0,0,0,28,1,0,0,4,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,1,0,0,0,30,1,0,0,7,0,0,0,3,0,0,0,19,1,0,0,20,1,0,0,27,1,0,0,7,0,0,0,3,0,0,0,19,1,0,0,21,1,0,0,29,1,0,0,7,0,0,0,3,0,0,0,19,1,0,0,22,1,0,0,31,1,0,0,9,0,0,0,1,0,0,0,19,1,0,0,7,0,0,0,3,0,0,0,18,1,0,0,23,1,0,0,7,1,0,0,7,0,0,0,3,0,0,0,18,1,0,0,24,1,0,0,35,1,0,0,9,0,0,0,1,0,0,0,18,1,0,0,14,0,0,0,0,0,0,0,7,0,0,0,3,0,0,0,39,1,0,0,25,1,0,0,38,1,0,0,7,0,0,0,3,0,0,0,39,1,0,0,20,1,0,0,38,1,0,0,9,0,0,0,1,0,0,0,39,1,0,0,2,0,0,0,2,0,0,0,38,4,0,0,4,0,0,0,2,0,0,0,2,0,0,0,42,4,0,0,4,0,0,0,2,0,0,0,2,0,0,0,46,4,0,0,4,0,0,0,2,0,0,0,2,0,0,0,50,4,0,0,1,0,0,0,14,0,0,0,0,0,0,0,7,0,0,0,3,0,0,0,47,1,0,0,43,1,0,0,13,1,0,0,7,0,0,0,3,0,0,0,47,1,0,0,44,1,0,0,42,1,0,0,7,0,0,0,3,0,0,0,47,1,0,0,45,1,0,0,17,1,0,0,10,0,0,0,2,0,0,0,46,1,0,0,47,1,0,0,4,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,1,0,0,0,52,1,0,0,4,0,0,0,2,0,0,0,0,0,0,0,0,0,0,0,8,0,0,0,1,0,0,0,54,1,0,0,4,0,0,0,1,0,0,0,0,0,0,0,4,0,0,0,1,0,0,0,1,0,0,0,4,0,0,0,1,0,0,0,2,0,0,0,12,0,0,0,1,0,0,0,7,1,0,0,7,0,0,0,3,0,0,0,9,1,0,0,56,1,0,0,59,1,0,0,12,0,0,0,1,0,0,0,53,1,0,0,7,0,0,0,3,0,0,0,9,1,0,0,57,1,0,0,61,1,0,0,12,0,0,0,1,0,0,0,55,1,0,0,7,0,0,0,3,0,0,0,9,1,0,0,58,1,0,0,63,1,0,0,4,0,0,0,1,0,0,0,3,0,0,0,7,0,0,0,3,0,0,0,9,1,0,0,65,1,0,0,51,1,0,0,1,0,0,0,1,0,0,0,52,4,0,0,119,97,104,95,112,111,108,121,103,108,111,116,95,115,116,97,103,101,51,119,97,115,109,102,100,115,105,110,105,116,105,110,105,116,48,49,50,101,120,101,102,100,115,101,108,102,98,111,111,116,112,114,111,99,115,98,105,110,47,0".split(",");
  return Uint8Array.from(data, (c) => parseInt(c, 10));
}

// stage2-wasi.js
async function fallback_shell(configuration, error) {
  let shell = document.createElement("div");
  shell.innerHTML = `<p>Missing boot exec</p>`;
  if (error !== void 0) {
    shell.innerHTML = `<p>Error: ${error}</p>`;
  }
  shell.innerHTML += `<p>WAH rescue shell</p>`;
  const rootfs = configuration.fds[3];
  function mkDirElement(dir) {
    const list = document.createElement("ul");
    for (const [name, entry] of Object.entries(dir.contents)) {
      const el = document.createElement("li");
      el.innerText = name;
      if (entry instanceof Directory) {
        const sublist = mkDirElement(entry);
        el.appendChild(sublist);
      } else {
        el.innerText = "";
        const btn = document.createElement("a");
        const blob = new Blob([entry.data]);
        btn.innerText = name;
        btn.download = name;
        btn.href = URL.createObjectURL(blob);
        el.appendChild(btn);
      }
      list.appendChild(el);
    }
    return list;
  }
  ;
  if (rootfs) {
    shell.innerHTML += `<p>Filesystem: </p>`;
    shell.appendChild(mkDirElement(rootfs.dir));
  }
  console.log(error);
  document.firstElementChild.appendChild(shell);
}
var KernelCallPromise = class {
  #promise;
  #reject;
  #resolve;
  constructor() {
    let p = Promise.withResolvers();
    this.#promise = p.promise;
    this.#reject = p.reject;
    this.#resolve = p.resolve;
  }
  promise() {
    return this.#promise;
  }
  reject(reason) {
    this.#reject(reason);
  }
  resolve(value) {
    this.#resolve(value);
  }
};
async function createSandbox({
  /* A Promise to a Response object that resolves to the WASM kernel module. */
  module_or_path,
  /* An array with the elements of the root FS as a tar-like structure */
  wasi_root_fs,
  /* An (Object) URL resolving to the stage 2 code itself */
  wasi_stage_url
}) {
  const wasmbody = await (await module_or_path).arrayBuffer();
  const module_src = await (await fetch(wasi_stage_url)).text();
  let idx = module_src.search(/(\s|;)export\s/);
  let modBlob = new Blob([module_src.slice(0, idx)], { type: "text/javascript" });
  let moduleURL = URL.createObjectURL(modBlob);
  var worker = new Worker(moduleURL, { type: "classic" });
  var worker_state = {
    elements: /* @__PURE__ */ new Map(),
    reaper: /* @__PURE__ */ new Map(),
    reaper_logging: new FinalizationRegistry((pid) => {
      console.warn(`Process ${pid} no longer reapable`);
    }),
    fid_counter: 65536,
    kernel: {
      // Promise that is ready when the kernel signals finishing its own boot (general readiness).
      boot: Promise.withResolvers(),
      // Promise that is ready when the kernel signals we can interact with its filesystem.
      filesystem: Promise.withResolvers(),
      // Promise that is ready when the kernel signals we can spawn processes.
      create_proc: Promise.withResolvers()
    },
    worker,
    wasi_stage_url,
    commands: /* @__PURE__ */ new Map(),
    promises: [],
    runModuleFromBlob: async (blobURL, options, ed) => {
      try {
        let dispatch = await import(blobURL, options?.import);
        let result = dispatch.default(worker_state, options);
        worker.postMessage({ "completed": { ed, result } });
        ed = void 0;
      } catch (e) {
        console.log("Bad module", e);
        if (ed) {
          worker.postMessage({ "completed": { ed, error: "" + e } });
        }
      }
    },
    createFirmware: function(promise) {
      worker_state.reaper_logging.register(promise, "firmware");
      worker_state.promises.push(promise);
    },
    // Return a promise that resolves when the process with the given configuration is reaped.
    createProcess: function({ stdin, stdout, stderr, env, args }) {
      function mk_output(obj) {
        if (obj == void 0) {
          return { null: true };
        }
        if (Object.keys(obj).length != 1) {
          throw { error: { bad_io_binding: obj } };
        }
        if (obj.pipe) {
          const { pipe } = obj;
          return { pipe: !!pipe };
        } else if (obj.file) {
          const { file } = obj;
          return { file: "" + file };
        } else if (obj.null) {
          return { null: true };
        }
        throw { error: { unknown_io_binding: obj } };
      }
      function mk_input(obj, transfer2) {
        if (obj == void 0) {
          return { null: true };
        }
        if (Object.keys(obj).length != 1) {
          throw { error: { bad_io_binding: obj } };
        }
        if (obj.file) {
          const { file } = obj;
          return { file: "" + file };
        } else if (obj.pipe) {
          const { pipe } = obj;
          if (!(pipe instanceof ArrayBuffer)) {
            throw "Pipe must be an array buffer of given input";
          }
          transfer2.push(pipe);
          return { pipe };
        } else if (obj.null) {
          return { null: true };
        }
        throw { error: { unknown_io_binding: obj } };
      }
      const fid = this.fid_counter;
      this.fid_counter += 1;
      let reaper = this._create_reaper(fid);
      let transfer = [];
      worker.postMessage({
        "create-proc": {
          stdin: mk_input(stdin, transfer),
          stdout: mk_output(stdout),
          stderr: mk_output(stderr),
          env: env?.map((e) => "" + e),
          args: args?.map((e) => "" + e),
          fid
        }
      });
      return reaper;
    },
    fsRead(files) {
      const fid = this.fid_counter;
      this.fid_counter += 1;
      let reaper = this._create_reaper(fid);
      worker.postMessage({
        "fs-read": {
          files,
          fid
        }
      });
      return reaper;
    },
    _create_reaper: function(fid) {
      const result = new KernelCallPromise();
      result.fid = fid;
      this.reaper.set(fid, result);
      this.reaper_logging.register(result, fid);
      return result;
    },
    init_proc(id) {
      if (id > 65535)
        throw "Not an init process";
      let fallback = void 0;
      if (!this.reaper.has(id)) {
        fallback = new KernelCallPromise();
        this.reaper.set(id, fallback);
        this.reaper_logging.register(fallback, id);
      }
      return this.reaper.get(id);
    }
  };
  worker.onmessage = (event2) => {
    let data = event2.data;
    let transfer = data.transfer || [];
    delete data.transfer;
    if (Object.keys(data).length != 1) {
      data = { error: { invalid_message: event2 } };
    }
    const [command, value] = Object.entries(data)[0];
    const handler = worker_state.commands.get(command);
    if (handler)
      handler(value, worker_state, { event: event2 });
    else
      console.warn("Unknown command from kernel", command, value);
  };
  worker_state.commands.set("error", (data) => {
    console.log("Kernel error", data);
    const { configuration, error } = data;
    fallback_shell(configuration, error);
  });
  worker_state.commands.set("module", (data) => {
    const { module, type, options, ed } = data;
    let blob = new Blob([module], { type: "application/javascript" });
    let blobURL = URL.createObjectURL(blob);
    worker_state.runModuleFromBlob(blobURL, options, ed);
  });
  worker_state.commands.set("reap", (data) => {
    const { stdout, stderr, status, pid, fid } = data;
    const reaper = worker_state.reaper.get(fid);
    worker_state.reaper.delete(fid);
    if (reaper == void 0) {
      console.warn(`Process ${pid} reaped with no reaper`, data);
      return;
    }
    reaper?.resolve({ stdout, stderr, status, pid, fid });
  });
  worker_state.commands.set("run-level", (data) => {
    const levels = Object.assign({ "boot": 0, "filesystem": 0, "create-proc": 0 }, data);
    if (levels["boot"] > 0) {
      worker_state.kernel.boot.resolve();
    }
    if (levels["filesystem"] > 0) {
      worker_state.kernel.filesystem.resolve();
    }
    if (levels["create-proc"] > 0) {
      worker_state.kernel.create_proc.resolve();
    }
    console.log(`Kernel reached run level ${data}`);
  });
  worker_state.commands.set("fs-read", (data) => {
    const { files, fid } = data;
    const reaper = worker_state.reaper.get(fid);
    worker_state.reaper.delete(fid);
    if (reaper == void 0) {
      return;
    }
    reaper?.resolve({ files });
  });
  worker_state.commands.set("element-select", (data) => {
    const { ed, selectors } = data;
    var element = null;
    for (var selector of selectors) {
      if (selector["by-id"]) {
        element = document.getElementById(selector["by-id"]);
      } else if (selector["by-class-name"]) {
        element = document.getElementsByClassName(selector["by-class-name"]);
        if (!selector.multi) {
          element = element[0];
        }
      } else if (selector["by-tag-name"]) {
        element = document.getElementsByTagName(selector["by-tag-name"]);
        if (!selector.multi) {
          element = element[0];
        }
      }
      if (element !== null) {
        console.log("Matched ", selector, element);
        break;
      }
    }
    console.log("Opening element descriptor", ed, element);
    worker_state.elements.set(ed, element);
  });
  worker_state.commands.set("element-exec", (data) => {
    const { ed, fn, args, ret } = event.data["element-exec"];
    const fn_js = new Function("return " + fn)();
    const element = worker_state.elements.get(ed);
    let result = fn_js(element, ...args);
    if (ret) {
      console.log("Invoked result", ret, result);
      worker.postMessage({ "completed": { ed: ret, result } });
    }
  });
  worker_state.commands.set("element-insert", (data) => {
    const { ed, innerHTML } = data;
    console.log(ed, worker_state.elements.get(ed));
    worker_state.elements.get(ed).innerHTML = innerHTML;
  });
  worker_state.commands.set("element-replace", (data) => {
    const { ed, outerHTML } = data;
    worker_state.elements.get(ed).outerHTML = outerHTML;
    worker_state.elements.delete(ed);
  });
  wasi_root_fs = wasi_root_fs.map(({ header, data }) => {
    return { header, data };
  });
  worker.postMessage({
    start: {
      wasi_root_fs,
      wasm_body: wasmbody
    }
  }, [wasmbody]);
  console.log("Mounted and running async");
  initialize_firmware(worker_state);
  await worker_state.kernel.boot.promise;
  console.log("Kernel reach run-level booted");
  while (worker_state.promises.length > 0) {
    let worker_promises = worker_state.promises.splice(0, Infinity);
    if (worker_promises.length == 0) {
      break;
    }
    await Promise.allSettled(worker_promises);
  }
  console.log("All firmware processes completed, shutdown?");
}
async function initialize_firmware(worker_state) {
  let headElement = document.getElementsByTagName("head");
  if (headElement.length == 0) {
    return;
  }
  let metas = Array.from(headElement[0]?.querySelectorAll(':scope>meta[itemprop="wasi-document"]'));
  let declarative = metas.find((el) => el.content == "init-declarative");
  if (declarative) {
    let stop_at = Promise.withResolvers();
    let observer = new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        let removed = Array.from(mutation.removedNodes || []);
        if (removed.indexOf(declarative) >= 0) {
          console.trace("Stopping observation of declarative wasi-document elements");
          observer.disconnect();
          stop_at.resolve(observer);
        }
      }
    });
    console.trace("Running in declarative mode, observing meta element for stop");
    observer.observe(headElement[0], { childList: true, subtree: false });
    worker_state.promises.push(stop_at.promise);
  }
  if (metas.find((el) => el.content == "wasi-document-output")) {
    let templates = Array.from(document.getElementsByClassName("wasi-document-process")).filter((el) => el.tagName == "TEMPLATE");
    let template_map = templates.reduce((acc, el) => {
      let key = el.getAttribute("data-process");
      acc.set(key, el);
      return acc;
    }, /* @__PURE__ */ new Map());
    class WasiDocumentElement extends HTMLElement {
      static worker_state = worker_state;
      static template_map = template_map;
      static observedAttributes = ["data-wasi-process"];
      constructor() {
        super();
        this.proc_id = this.getAttribute("data-wasi-process");
      }
      connectedCallback() {
        let process_template = this.constructor.template_map.get(this.proc_id);
        console.log("Running process from template", process_template);
        let promise = this.#instantiate(process_template);
      }
      #instantiate(template) {
        const template_node = this.ownerDocument.importNode(template.content, true);
        const rendered = this.insertAdjacentElement("beforeend", this.ownerDocument.createElement("aside"));
        let contents = new DocumentFragment();
        contents.replaceChildren(...this.cloneNode(true).children);
        rendered.append(contents);
        rendered.hidden = true;
        const shadowRoot = rendered.attachShadow({ mode: "open", slotAssignment: "named" });
        shadowRoot.appendChild(template_node);
        if (shadowRoot.querySelector("slot")) {
          shadowRoot.addEventListener("slotchange", this.#ondefinitionready.bind(this, rendered), { once: false });
        } else {
          this.#ondefinitionready(rendered);
        }
      }
      #ondefinitionready(rendered) {
        let create_process = this.#build_create_process(rendered.shadowRoot);
        let worker_state2 = WasiDocumentElement.worker_state;
        worker_state2.kernel.create_proc.promise.then(() => {
          console.log("Creating process with", create_process);
          let reaper = worker_state2.createProcess(create_process);
          this.fid = reaper.fid;
          reaper.promise().then((result) => {
            this.#assignresult(rendered, result);
          });
        });
      }
      #build_create_process(root) {
        let assignees = [...root.querySelectorAll("slot")].flatMap((slot) => slot.assignedElements({ flatten: true }));
        let recursive = assignees.flatMap((el) => [...el.querySelectorAll(":scope [itemprop]")]);
        let props = [
          ...root.querySelectorAll("[itemprop]"),
          ...assignees.filter((el) => el.hasAttribute("itemprop")),
          ...recursive
        ];
        let args = props.filter((el) => el.getAttribute("itemprop") == "args");
        let env = props.filter((el) => el.getAttribute("itemprop") == "env");
        let fds = props.filter((el) => el.getAttribute("itemprop") == "fd");
        let stdin = fds.find((el) => el.getAttribute("data-fd") == "0");
        let stdout = fds.find((el) => el.getAttribute("data-fd") == "1");
        let stderr = fds.find((el) => el.getAttribute("data-fd") == "2");
        const io_element = (el) => {
          if ((el || null) == null)
            return { null: true };
          else if (el.tagName == "A")
            return { file: el.href };
          else
            return { pipe: true };
        };
        return {
          args: args.map((el) => el.textContent),
          env: env.map((el) => el.textContent),
          stdin: io_element(stdin),
          stdout: io_element(stdout),
          stderr: io_element(stderr)
        };
      }
      #assignresult(rendered, { stdout, stderr, status }) {
        rendered.remove();
        const command = this.getAttribute("command");
        const commandFor = this.getAttribute("commandFor");
        let target = commandFor ? document.getElementById(commandFor) : this;
        if (command == "stdout" || command == null) {
          const utf8decoder = new TextDecoder();
          target.innerHTML = utf8decoder.decode(stdout);
        } else if (command == "stderr") {
          const utf8decoder = new TextDecoder();
          target.innerHTML = utf8decoder.decode(stderr);
        } else if (command == "event") {
          let event2 = new CustomEvent("wasi-process-settled", {
            bubbles: true,
            detail: { stdout, stderr, status, fid: this.fid }
          });
          target.dispatchEvent(event2);
        }
      }
    }
    customElements.define("wasi-document-output", WasiDocumentElement);
  }
}
var worker_side_state = void 0;
onmessage = (event2) => {
  console.log("worker received", event2.data);
  if (event2.data.start) {
    const { wasm_body, wasi_root_fs } = event2.data.start;
    let channel = new MessageChannel();
    worker_side_state = {
      proxy_port: channel.port1
    };
    channel.port1.onmessage = (event3) => {
      const whatever = event3.data;
      console.log("worker sent", whatever);
      self.postMessage(whatever, whatever.transfer || []);
    };
    worker_mount({
      wasm_body,
      wasi_root_fs,
      port: channel.port2
    });
  } else if (event2.data.completed) {
    const { ed, result, error, transfer } = event2.data.completed;
    worker_side_state.proxy_port.postMessage({ completed: { ed, result, error, transfer } }, transfer);
  } else {
    console.warn("worker received message may not be proxied correctly to kernel", event2.data);
    worker_side_state.proxy_port.postMessage(event2.data, event2.data.transfer);
  }
};
async function worker_mount({
  wasm_body,
  wasi_root_fs,
  port
}) {
  const wasmblob = new Blob([wasm_body], { type: "application/wasm" });
  const response = new Response(wasmblob);
  const [body_wasm, body_file] = response.body.tee();
  let kernel_wasm = await WebAssembly.compileStreaming(new Response(body_wasm, {
    "status": response.status,
    "statusText": response.statusText,
    "headers": response.headers
  }));
  const body_to_array_buffer = async function(response2, body_file2) {
    const newbody = new Response(body_file2, {
      "status": response2.status,
      "statusText": response2.statusText,
      "headers": response2.headers
    });
    return await newbody.arrayBuffer();
  };
  var configuration = {
    args: ["exe"],
    env: [],
    fds: [],
    wasm: await body_to_array_buffer(response, body_file),
    wasm_module: kernel_wasm
  };
  let trigger_fallback = (configuration2, error) => {
    port.postMessage({
      error: {
        configuration: {
          fds: [null, null, null, null]
        },
        error
      }
    });
  };
  let wah_wasi_config_data = WebAssembly.Module.customSections(kernel_wasm, "wah_wasi_config");
  wah_wasi_config_data.unshift(new TextEncoder("utf-8").encode("{}"));
  if (wah_wasi_config_data.length > 1) {
    throw `Multiple configuration sections 'wah_wasi_config' detected`;
  } else {
    const instr_debugging = console.log;
    let raw_configuration = await load_config(wah_wasi_config_data[0]);
    let data = new Uint8Array(raw_configuration.buffer);
    let instruction_stream = new Uint32Array(raw_configuration.buffer);
    var iptr = 0;
    const ops = [
      /* 0: the configuration object */
      configuration,
      /* 1: skip */
      (cnt) => {
        instr_debugging(`skip ${cnt} to ${iptr + cnt}`);
        return iptr += cnt;
      },
      /* 2: string */
      (ptr, len) => {
        instr_debugging(`decode ${ptr} to ${ptr + len}`);
        return new TextDecoder("utf-8").decode(data.subarray(ptr, ptr + len));
      },
      /* 3: json */
      (ptr, len) => {
        instr_debugging(`json ${ptr} to ${ptr + len}`);
        return JSON.parse(data.subarray(ptr, ptr + len));
      },
      /* 4: integer const */
      (c) => {
        instr_debugging(`const ${c}`);
        return c;
      },
      /* 5: array */
      (ptr, len) => {
        instr_debugging(`array ${ptr} to ${ptr + len}`);
        return data.subarray(ptr, ptr + len);
      },
      /* 6: get */
      (from, idx) => {
        instr_debugging("get", from, ops[idx], ops[from][ops[idx]]);
        return ops[from][ops[idx]];
      },
      /* 7: set */
      (into, idx, what) => {
        instr_debugging("set", into, ops[idx], ops[what]);
        return ops[into][ops[idx]] = ops[what];
      },
      /* 8: File */
      (what) => {
        instr_debugging("file", ops[what]);
        return new File(ops[what]);
      },
      /* 9: Directory */
      (what) => {
        instr_debugging("directory", ops[what]);
        return new Directory(Object.entries(ops[what]));
      },
      /* 10: PreopenDirectory */
      (where, what) => {
        instr_debugging("preopen directory", ops[where], ops[what]);
        return new PreopenDirectory(ops[where], Object.entries(ops[what]));
      },
      /* 11: Directory.open */
      (dir, im_flags, path, im_oflags) => {
        instr_debugging("diropen", dir, im_flags, ops[path], im_oflags);
        return ops[dir].path_open(im_flags, ops[path], im_oflags).fd_obj;
      },
      /* 12: OpenFile */
      (what) => {
        instr_debugging("fileopen", ops[what]);
        return new OpenFile(ops[what]);
      },
      /* 13: section */
      // FIXME: maybe pass the module itself explicitly?
      // Do we want to support compiling modules already at this point?
      (what) => {
        instr_debugging("wasm", ops[what]);
        return WebAssembly.Module.customSections(kernel_wasm, ops[what]);
      },
      /* 14: no-op */
      function() {
        instr_debugging("noop", arguments);
        return {};
      },
      /* 15: function */
      (what) => {
        instr_debugging("function", ops[what]);
        return new Function(ops[what]);
      }
    ];
    ops[255] = void 0;
    try {
      while (iptr < instruction_stream.length) {
        let fn_ = ops[instruction_stream.at(iptr)];
        let acnt = instruction_stream.at(iptr + 1);
        let args2 = instruction_stream.subarray(iptr + 2, iptr + 2 + acnt);
        ops.push(fn_.apply(null, args2));
        iptr += 2 + acnt;
      }
    } catch (e) {
      console.log("Instructions failed", e);
      console.log(ops);
      trigger_fallback(configuration, e);
    }
    console.log(`Initialized towards stage3 in ${ops.length - 256} steps`);
  }
  let args = configuration.args;
  let env = configuration.env;
  let fds = configuration.fds;
  let filesystem = configuration.fds[3];
  configuration.WASI = WASI;
  configuration.shim = {
    Directory,
    Inode,
    File,
    PreopenDirectory,
    WASIProcExit
  };
  if (wasi_root_fs) {
    let wasi_root_files = new Map(wasi_root_fs.map((item) => [item.header.name, item.data]));
    for (const [key, value] of wasi_root_files) {
      let dirs = key.split("/");
      const file = dirs.pop();
      let basedir = filesystem;
      for (let dir of dirs) {
        let reldir = basedir.path_open(0, dir, WASI.OFLAGS_DIRECTORY);
        if (!reldir.fd_obj) {
          basedir.path_create_directory(dir);
          reldir = basedir.path_open(0, dir, WASI.OFLAGS_DIRECTORY);
        }
        if (!reldir.fd_obj) {
          console.log("Did not create..", key, dir, reldir, filesystem);
          break;
        }
        basedir = reldir.fd_obj;
      }
      const maybefd = basedir.path_open(0, file, 1, 1);
      if (!maybefd.fd_obj) {
        console.log("Did not write..", file, key, maybefd, basedir);
        continue;
      }
      const data_array = new Uint8Array(value);
      maybefd.fd_obj.file.data = data_array;
    }
  }
  configuration.wasi = new WASI(args, env, fds);
  let inst = await WebAssembly.instantiate(kernel_wasm, {
    "wasi_snapshot_preview1": configuration.wasi.wasiImport
  });
  const [stdin, stdout, stderr] = configuration.fds;
  try {
    try {
      configuration.wasi.start(inst);
    } catch (e) {
      trigger_fallback(configuration, e);
      return;
    }
  } finally {
    console.log("Result(stdin )", new TextDecoder().decode(stdin.file.data));
    console.log("Result(stdout)", new TextDecoder().decode(stdout.file.data));
    console.log("Result(stderr)", new TextDecoder().decode(stderr.file.data));
  }
  let module = filesystem.path_open(0, "init.mjs", 0).fd_obj;
  if (module == null) {
    return trigger_fallback(configuration);
  }
  let blob = new Blob([module.file.data.buffer], { type: "application/javascript" });
  let blobURL = URL.createObjectURL(blob);
  let stage3_module = await import(blobURL);
  configuration.fallback_shell = trigger_fallback;
  configuration.port = port;
  console.log("executing boot module");
  try {
    await stage3_module.default(configuration);
  } catch (e) {
    trigger_fallback(configuration, e);
  }
  console.log("done with boot module");
}
var stage2_wasi_default = createSandbox;
export {
  stage2_wasi_default as default
};
