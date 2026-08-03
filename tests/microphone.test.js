const test = require('node:test');
const assert = require('node:assert/strict');

/*
 * Browser microphone controller tests with mocked browser globals.
 *
 * Strict TDD: these tests define the expected behaviour of
 * public/app/microphone.js before and after implementation.
 */

// ---------------------------------------------------------------------------
// Mock browser globals
// ---------------------------------------------------------------------------

function MockMediaRecorder(stream, opts) {
  this.stream = stream;
  this.opts = opts || {};
  this.state = 'inactive';
  this.mimeType = (this.opts && this.opts.mimeType) || 'audio/webm';
  this._handlers = {};
  this._chunks = [];
  Object.defineProperty(this, 'ondataavailable', {
    set: function (fn) { this._handlers.dataavailable = fn; },
    get: function () { return this._handlers.dataavailable; },
  });
  Object.defineProperty(this, 'onstop', {
    set: function (fn) { this._handlers.stop = fn; },
    get: function () { return this._handlers.stop; },
  });
  Object.defineProperty(this, 'onerror', {
    set: function (fn) { this._handlers.error = fn; },
    get: function () { return this._handlers.error; },
  });
  Object.defineProperty(this, 'onstart', {
    set: function (fn) { this._handlers.start = fn; },
    get: function () { return this._handlers.start; },
  });
}

MockMediaRecorder._supported = ['audio/webm;codecs=opus', 'audio/webm'];
MockMediaRecorder.isTypeSupported = function (mime) {
  return MockMediaRecorder._supported.indexOf(mime) !== -1;
};

MockMediaRecorder.prototype.start = function () { this.state = 'recording'; if (this._handlers.start) this._handlers.start(); };
MockMediaRecorder.prototype.stop = function () {
  this.state = 'inactive';
  if (this._handlers.dataavailable) this._handlers.dataavailable({ data: { size: 1024, type: this.mimeType } });
  if (this._handlers.stop) this._handlers.stop();
};
MockMediaRecorder.prototype.requestData = function () { if (this._handlers.dataavailable) this._handlers.dataavailable({ data: { size: 512, type: this.mimeType } }); };

function MockStream() {
  this._tracks = [{ stop: function () {} }];
}
MockStream.prototype.getTracks = function () { return this._tracks; };

function MockBlob(parts, opts) {
  this.size = 1024;
  this.type = (opts && opts.type) || 'audio/webm';
  this.parts = parts || [];
}

function setupBrowserGlobals(config) {
  config = config || {};
  global.window = global.window || {};
  global.window.MediaRecorder = config.MediaRecorder === null ? undefined : MockMediaRecorder;
  global.window.SpeechRecognition = config.SpeechRecognition || undefined;
  global.window.webkitSpeechRecognition = config.webkitSpeechRecognition || undefined;
  global.MediaRecorder = global.window.MediaRecorder;
  global.Blob = config.Blob || MockBlob;
  global.fetch = config.fetch || (async function () {
    return { ok: true, status: 200, json: async function () { return { ok: true, text: 'hello world' }; } };
  });
  global.navigator = {
    mediaDevices: config.mediaDevices === null ? undefined : {
      getUserMedia: config.getUserMedia || (async function () { return new MockStream(); }),
    },
  };
  if (config.SpeechRecognitionClass) {
    global.window.SpeechRecognition = config.SpeechRecognitionClass;
  }
}

function teardownBrowserGlobals() {
  delete global.window;
  delete global.navigator;
  delete global.MediaRecorder;
  delete global.Blob;
  delete global.fetch;
}

function freshModule() {
  delete require.cache[require.resolve('../public/app/microphone.js')];
  return require('../public/app/microphone.js');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('createMicrophoneController is exported and returns a controller', () => {
  setupBrowserGlobals();
  try {
    const mod = freshModule();
    assert.equal(typeof mod.createMicrophoneController, 'function');
    const ctrl = mod.createMicrophoneController({});
    assert.equal(typeof ctrl.start, 'function');
    assert.equal(typeof ctrl.stop, 'function');
    assert.equal(typeof ctrl.destroy, 'function');
    assert.equal(typeof ctrl.getState, 'function');
    assert.equal(typeof ctrl.isSupported, 'function');
    assert.equal(typeof ctrl.getMimeType, 'function');
  } finally {
    teardownBrowserGlobals();
  }
});

test('isSupported returns true when MediaRecorder and getUserMedia are available', () => {
  setupBrowserGlobals();
  try {
    const { createMicrophoneController } = freshModule();
    const ctrl = createMicrophoneController({});
    assert.equal(ctrl.isSupported(), true);
  } finally {
    teardownBrowserGlobals();
  }
});

test('isSupported returns false when MediaRecorder is missing', () => {
  setupBrowserGlobals({ MediaRecorder: null });
  try {
    const { createMicrophoneController } = freshModule();
    const ctrl = createMicrophoneController({});
    assert.equal(ctrl.isSupported(), false);
  } finally {
    teardownBrowserGlobals();
  }
});

test('isSupported returns false when getUserMedia is missing', () => {
  setupBrowserGlobals({ mediaDevices: null });
  try {
    const { createMicrophoneController } = freshModule();
    const ctrl = createMicrophoneController({});
    assert.equal(ctrl.isSupported(), false);
  } finally {
    teardownBrowserGlobals();
  }
});

test('getMimeType returns a supported audio MIME type', () => {
  setupBrowserGlobals();
  try {
    const { createMicrophoneController } = freshModule();
    const ctrl = createMicrophoneController({});
    const mime = ctrl.getMimeType();
    assert.ok(mime.indexOf('audio/') === 0, 'mime starts with audio/');
    assert.ok(MockMediaRecorder.isTypeSupported(mime), 'mime is supported');
  } finally {
    teardownBrowserGlobals();
  }
});

test('start requests getUserMedia, creates MediaRecorder, calls onStart, sets state to recording', async () => {
  setupBrowserGlobals();
  try {
    const { createMicrophoneController } = freshModule();
    let states = [];
    let startCalled = false;
    const ctrl = createMicrophoneController({
      onStart: function () { startCalled = true; },
      onState: function (s) { states.push(s); },
    });
    await ctrl.start();
    assert.equal(startCalled, true, 'onStart callback fired');
    assert.equal(ctrl.getState(), 'recording');
    assert.ok(states.indexOf('recording') !== -1, 'state transitions include recording');
    ctrl.destroy();
  } finally {
    teardownBrowserGlobals();
  }
});

test('stop sends blob to backend and calls onTranscript with returned text', async () => {
  let fetchArgs = null;
  setupBrowserGlobals({
    fetch: async function (url, opts) {
      fetchArgs = { url, method: opts.method, contentType: opts.headers['Content-Type'] };
      return { ok: true, status: 200, json: async function () { return { ok: true, text: 'yeh mon' }; } };
    },
  });
  try {
    const { createMicrophoneController } = freshModule();
    let transcript = null;
    const ctrl = createMicrophoneController({
      onTranscript: function (text) { transcript = text; },
    });
    await ctrl.start();
    ctrl.stop();
    // Wait for async transcription
    await new Promise(function (r) { setTimeout(r, 50); });
    assert.equal(fetchArgs.url, '/api/voice/transcribe');
    assert.equal(fetchArgs.method, 'POST');
    assert.equal(fetchArgs.contentType.indexOf('audio/'), 0);
    assert.equal(transcript, 'yeh mon');
    assert.equal(ctrl.getState(), 'idle');
  } finally {
    teardownBrowserGlobals();
  }
});

test('custom transcribeUrl is used', async () => {
  let calledUrl = null;
  setupBrowserGlobals({
    fetch: async function (url) { calledUrl = url; return { ok: true, status: 200, json: async function () { return { ok: true, text: '' }; } }; },
  });
  try {
    const { createMicrophoneController } = freshModule();
    const ctrl = createMicrophoneController({ transcribeUrl: '/custom/transcribe' });
    await ctrl.start();
    ctrl.stop();
    await new Promise(function (r) { setTimeout(r, 50); });
    assert.equal(calledUrl, '/custom/transcribe');
  } finally {
    teardownBrowserGlobals();
  }
});

test('max recording duration auto-stops after timeout', async () => {
  setupBrowserGlobals();
  try {
    const { createMicrophoneController } = freshModule();
    let stopCalled = false;
    const ctrl = createMicrophoneController({
      maxDurationMs: 30,
      onStop: function () { stopCalled = true; },
    });
    await ctrl.start();
    assert.equal(ctrl.getState(), 'recording');
    // Wait for timeout to fire
    await new Promise(function (r) { setTimeout(r, 80); });
    assert.equal(stopCalled, true, 'onStop called after max duration');
  } finally {
    teardownBrowserGlobals();
  }
});

test('permission denied sets state to denied and calls onError', async () => {
  setupBrowserGlobals({
    getUserMedia: async function () { throw new Error('Permission denied'); },
  });
  try {
    const { createMicrophoneController } = freshModule();
    let error = null;
    let states = [];
    const ctrl = createMicrophoneController({
      onError: function (e) { error = e; },
      onState: function (s) { states.push(s); },
    });
    await assert.rejects(function () { return ctrl.start(); });
    assert.equal(ctrl.getState(), 'denied');
    assert.ok(error, 'onError was called');
    assert.ok(states.indexOf('denied') !== -1, 'state transitions include denied');
  } finally {
    teardownBrowserGlobals();
  }
});

test('backend failure with no Web Speech fallback sets state to error and calls onError', async () => {
  setupBrowserGlobals({
    fetch: async function () { return { ok: false, status: 503, json: async function () { return { ok: false, message: 'not configured' }; } }; },
    SpeechRecognition: undefined,
    webkitSpeechRecognition: undefined,
  });
  try {
    const { createMicrophoneController } = freshModule();
    let error = null;
    const ctrl = createMicrophoneController({
      useWebSpeechFallback: false,
      onError: function (e) { error = e; },
    });
    await ctrl.start();
    ctrl.stop();
    await new Promise(function (r) { setTimeout(r, 50); });
    assert.equal(ctrl.getState(), 'error');
    assert.ok(error, 'onError was called');
    assert.match(error.message, /not configured|transcri/i);
  } finally {
    teardownBrowserGlobals();
  }
});

test('backend failure falls back to Web Speech when available', async () => {
  function MockRecognition() {
    this.lang = '';
    this._handlers = {};
  }
  MockRecognition.prototype.start = function () {
    var self = this;
    setTimeout(function () {
      if (self.onresult) self.onresult({ results: [{ 0: { transcript: 'fallback text' }, isFinal: true }] });
      if (self.onend) self.onend();
    }, 5);
  };
  MockRecognition.prototype.stop = function () { if (this.onend) this.onend(); };

  setupBrowserGlobals({
    fetch: async function () { return { ok: false, status: 503, json: async function () { return { ok: false, message: 'not configured' }; } }; },
    SpeechRecognitionClass: MockRecognition,
  });
  global.window.SpeechRecognition = MockRecognition;
  try {
    const { createMicrophoneController } = freshModule();
    let transcript = null;
    const ctrl = createMicrophoneController({
      onTranscript: function (t) { transcript = t; },
    });
    await ctrl.start();
    ctrl.stop();
    // Wait for backend failure + fallback
    await new Promise(function (r) { setTimeout(r, 100); });
    assert.equal(transcript, 'fallback text');
  } finally {
    teardownBrowserGlobals();
  }
});

test('Web Speech fallback disabled does not use SpeechRecognition', async () => {
  function MockRecognition() {}
  MockRecognition.prototype.start = function () { throw new Error('should not be called'); };

  setupBrowserGlobals({
    fetch: async function () { return { ok: false, status: 503, json: async function () { return { ok: false, message: 'not configured' }; } }; },
    SpeechRecognitionClass: MockRecognition,
  });
  global.window.SpeechRecognition = MockRecognition;
  try {
    const { createMicrophoneController } = freshModule();
    let error = null;
    const ctrl = createMicrophoneController({
      useWebSpeechFallback: false,
      onError: function (e) { error = e; },
    });
    await ctrl.start();
    ctrl.stop();
    await new Promise(function (r) { setTimeout(r, 50); });
    assert.equal(ctrl.getState(), 'error');
    assert.ok(error, 'onError called instead of fallback');
  } finally {
    teardownBrowserGlobals();
  }
});

test('destroy stops recording and cleans up resources', async () => {
  setupBrowserGlobals();
  try {
    const { createMicrophoneController } = freshModule();
    const ctrl = createMicrophoneController({});
    await ctrl.start();
    assert.equal(ctrl.getState(), 'recording');
    ctrl.destroy();
    assert.equal(ctrl.getState(), 'idle');
  } finally {
    teardownBrowserGlobals();
  }
});

test('start when already recording is a no-op', async () => {
  setupBrowserGlobals();
  try {
    const { createMicrophoneController } = freshModule();
    let startCount = 0;
    const ctrl = createMicrophoneController({
      onStart: function () { startCount++; },
    });
    await ctrl.start();
    await ctrl.start(); // second call should be no-op
    assert.equal(startCount, 1, 'onStart only fired once');
    ctrl.destroy();
  } finally {
    teardownBrowserGlobals();
  }
});

test('start when unsupported sets state to unsupported and rejects', async () => {
  setupBrowserGlobals({ MediaRecorder: null });
  try {
    const { createMicrophoneController } = freshModule();
    let error = null;
    const ctrl = createMicrophoneController({
      onError: function (e) { error = e; },
    });
    await assert.rejects(function () { return ctrl.start(); });
    assert.equal(ctrl.getState(), 'unsupported');
    assert.ok(error, 'onError called');
  } finally {
    teardownBrowserGlobals();
  }
});

test('onStop callback receives the recorded blob', async () => {
  setupBrowserGlobals();
  try {
    const { createMicrophoneController } = freshModule();
    let blobReceived = null;
    const ctrl = createMicrophoneController({
      onStop: function (blob) { blobReceived = blob; },
    });
    await ctrl.start();
    ctrl.stop();
    await new Promise(function (r) { setTimeout(r, 50); });
    assert.ok(blobReceived, 'onStop received a blob');
    assert.ok(blobReceived.type.indexOf('audio/') === 0, 'blob type is audio');
  } finally {
    teardownBrowserGlobals();
  }
});

test('MediaRecorder onerror fires onError and sets state to error', async () => {
  function ErrorMediaRecorder(stream, opts) {
    this.state = 'recording';
    this.mimeType = 'audio/webm';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    this.onstart = null;
  }
  ErrorMediaRecorder.isTypeSupported = function () { return true; };
  ErrorMediaRecorder.prototype.start = function () {
    var self = this;
    if (this.onstart) this.onstart();
    setTimeout(function () { if (self.onerror) self.onerror({ error: new Error('recorder crash') }); }, 5);
  };
  ErrorMediaRecorder.prototype.stop = function () { this.state = 'inactive'; };

  setupBrowserGlobals({
    MediaRecorder: ErrorMediaRecorder,
  });
  global.window.MediaRecorder = ErrorMediaRecorder;
  global.MediaRecorder = ErrorMediaRecorder;
  try {
    const { createMicrophoneController } = freshModule();
    let error = null;
    const ctrl = createMicrophoneController({
      onError: function (e) { error = e; },
    });
    await ctrl.start();
    await new Promise(function (r) { setTimeout(r, 30); });
    assert.equal(ctrl.getState(), 'error');
    assert.ok(error, 'onError called from MediaRecorder error');
  } finally {
    teardownBrowserGlobals();
  }
});

test('getSpeechRecognition returns constructor when available', () => {
  function MockRec() {}
  setupBrowserGlobals({ SpeechRecognitionClass: MockRec });
  global.window.SpeechRecognition = MockRec;
  try {
    const { createMicrophoneController } = freshModule();
    const ctrl = createMicrophoneController({});
    assert.equal(typeof ctrl.getSpeechRecognition, 'function');
    var rec = ctrl.getSpeechRecognition();
    assert.ok(rec, 'returns a truthy constructor');
  } finally {
    teardownBrowserGlobals();
  }
});

test('backend returns empty text calls onTranscript with empty string and returns to idle', async () => {
  setupBrowserGlobals({
    fetch: async function () { return { ok: true, status: 200, json: async function () { return { ok: true, text: '' }; } }; },
  });
  try {
    const { createMicrophoneController } = freshModule();
    let transcript = 'unchanged';
    const ctrl = createMicrophoneController({
      onTranscript: function (t) { transcript = t; },
    });
    await ctrl.start();
    ctrl.stop();
    await new Promise(function (r) { setTimeout(r, 50); });
    assert.equal(transcript, '');
    assert.equal(ctrl.getState(), 'idle');
  } finally {
    teardownBrowserGlobals();
  }
});
