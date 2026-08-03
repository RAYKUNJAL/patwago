/**
 * MicrophoneController — reusable browser microphone controller.
 *
 * Primary strategy: MediaRecorder → POST blob to backend /api/voice/transcribe.
 * Web Speech API is only used as a fallback when the backend is unavailable AND
 * the caller has not disabled it with `useWebSpeechFallback: false`.
 *
 * Works in modern Chrome/Safari. Uses explicit feature detection rather than
 * UA sniffing. All browser globals are accessed defensively so the module can
 * be required from Node for testing with mocked globals.
 *
 * Public API:
 *   var ctrl = createMicrophoneController({ onStart, onStop, onTranscript,
 *     onError, onState, maxDurationMs, transcribeUrl, useWebSpeechFallback });
 *   ctrl.isSupported()
 *   ctrl.getMimeType()
 *   ctrl.getState()          // 'idle'|'recording'|'denied'|'error'|'unsupported'
 *   ctrl.start()
 *   ctrl.stop()
 *   ctrl.destroy()
 *   ctrl.getSpeechRecognition()
 */
(function (root) {
  'use strict';

  var DEFAULT_TRANSCRIBE_URL = '/api/voice/transcribe';
  var DEFAULT_MAX_DURATION_MS = 60_000; // 60 seconds

  var PREFERRED_MIME_TYPES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];

  function isMediaRecorderSupported() {
    var w = root || (typeof window !== 'undefined' ? window : null);
    var nav = (typeof navigator !== 'undefined') ? navigator : null;
    return !!(w && w.MediaRecorder && nav && nav.mediaDevices && nav.mediaDevices.getUserMedia);
  }

  function pickMimeType() {
    var w = root || (typeof window !== 'undefined' ? window : null);
    if (!w || !w.MediaRecorder || !w.MediaRecorder.isTypeSupported) return 'audio/webm';
    for (var i = 0; i < PREFERRED_MIME_TYPES.length; i++) {
      try {
        if (w.MediaRecorder.isTypeSupported(PREFERRED_MIME_TYPES[i])) return PREFERRED_MIME_TYPES[i];
      } catch (e) { /* continue */ }
    }
    return '';
  }

  function getSpeechRecognitionConstructor() {
    var w = (typeof window !== 'undefined' && window) ? window : root;
    if (!w) return null;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  function createMicrophoneController(options) {
    options = options || {};

    var config = {
      transcribeUrl: options.transcribeUrl || DEFAULT_TRANSCRIBE_URL,
      maxDurationMs: options.maxDurationMs || DEFAULT_MAX_DURATION_MS,
      useWebSpeechFallback: options.useWebSpeechFallback !== false,
    };

    var state = isMediaRecorderSupported() ? 'idle' : 'unsupported';
    var mediaRecorder = null;
    var stream = null;
    var chunks = [];
    var maxTimer = null;
    var stopping = false;

    // --- Callbacks ---------------------------------------------------------
    function onStart() { if (options.onStart) options.onStart(); }
    function onStop(blob) { if (options.onStop) options.onStop(blob); }
    function onTranscript(text) { if (options.onTranscript) options.onTranscript(text); }
    function onError(err) { if (options.onError) options.onError(err); }
    function setState(next) {
      state = next;
      if (options.onState) options.onState(next);
    }

    // --- Public methods ----------------------------------------------------

    function getState() { return state; }

    function isSupported() { return isMediaRecorderSupported(); }

    function getMimeType() { return pickMimeType(); }

    function getSpeechRecognition() { return getSpeechRecognitionConstructor(); }

    function start() {
      if (state === 'recording') return Promise.resolve();
      if (!isMediaRecorderSupported()) {
        setState('unsupported');
        var err = new Error('Microphone recording is not supported in this browser.');
        onError(err);
        return Promise.reject(err);
      }
      var nav = (typeof navigator !== 'undefined') ? navigator : null;
      return nav.mediaDevices.getUserMedia({ audio: true }).then(function (s) {
        stream = s;
        var mimeType = pickMimeType();
        var ctorOpts = {};
        if (mimeType) ctorOpts.mimeType = mimeType;
        try {
          mediaRecorder = new (root || window).MediaRecorder(stream, ctorOpts);
        } catch (e) {
          // Some browsers throw if mimeType is unsupported; retry without options.
          mediaRecorder = new (root || window).MediaRecorder(stream);
        }
        chunks = [];
        stopping = false;

        mediaRecorder.ondataavailable = function (event) {
          if (event.data && event.data.size) chunks.push(event.data);
        };

        mediaRecorder.onerror = function (event) {
          var recErr = (event && event.error) ? event.error : new Error('MediaRecorder error');
          cleanupRecording();
          setState('error');
          onError(recErr);
        };

        mediaRecorder.onstop = function () {
          var blobParts = chunks.slice();
          chunks = [];
          var blob = new ((typeof Blob !== 'undefined' ? Blob : (root || window).Blob))(blobParts, { type: mediaRecorder.mimeType || 'audio/webm' });
          onStop(blob);
          cleanupStream();
          clearTimeout(maxTimer);
          maxTimer = null;
          transcribe(blob);
        };

        mediaRecorder.start();
        setState('recording');
        onStart();

        // Auto-stop after max duration. Use .unref() when available so this
        // timer never keeps the Node.js event loop alive after tests finish.
        maxTimer = setTimeout(function () {
          if (state === 'recording' && mediaRecorder && mediaRecorder.state === 'recording') {
            stopping = true;
            mediaRecorder.stop();
          }
        }, config.maxDurationMs);
        if (maxTimer && typeof maxTimer.unref === 'function') maxTimer.unref();

      }).catch(function (permErr) {
        cleanupStream();
        cleanupRecording();
        setState('denied');
        onError(permErr);
        throw permErr;
      });
    }

    function stop() {
      if (state !== 'recording' || !mediaRecorder) return;
      stopping = true;
      clearTimeout(maxTimer);
      maxTimer = null;
      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }

    function destroy() {
      clearTimeout(maxTimer);
      maxTimer = null;
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
      }
      cleanupRecording();
      cleanupStream();
      setState('idle');
    }

    // --- Internal helpers --------------------------------------------------

    function transcribe(blob) {
      var headers = {};
      if (blob.type) headers['Content-Type'] = blob.type;

      fetch(config.transcribeUrl, { method: 'POST', headers: headers, body: blob })
        .then(function (response) {
          return response.json().then(function (data) {
            if (!response.ok) {
              var msg = (data && (data.message || data.error)) || 'Transcription failed';
              throw new Error(msg);
            }
            return data;
          });
        })
        .then(function (data) {
          var text = (data && data.text) ? data.text : '';
          setState('idle');
          onTranscript(text);
        })
        .catch(function (fetchErr) {
          if (config.useWebSpeechFallback) {
            var Rec = getSpeechRecognitionConstructor();
            if (Rec) {
              tryWebSpeechFallback(fetchErr);
              return;
            }
          }
          setState('error');
          onError(fetchErr);
        });
    }

    function tryWebSpeechFallback(originalError) {
      var Rec = getSpeechRecognitionConstructor();
      if (!Rec) {
        setState('error');
        onError(originalError);
        return;
      }
      var recognition = null;
      try {
        recognition = new Rec();
      } catch (e) {
        setState('error');
        onError(originalError);
        return;
      }
      recognition.lang = 'en-US';
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = function (event) {
        var text = '';
        if (event.results) {
          for (var i = 0; i < event.results.length; i++) {
            if (event.results[i][0] && event.results[i][0].transcript) {
              text += event.results[i][0].transcript;
            }
          }
        }
        setState('idle');
        onTranscript(text.trim());
      };

      recognition.onerror = function () {
        setState('error');
        onError(originalError);
      };

      recognition.onend = function () {
        // If no result fired, ensure we return to idle
        if (state === 'recording' || state === 'idle') {
          setState('idle');
        }
      };

      try {
        recognition.start();
        setState('recording');
      } catch (e) {
        setState('error');
        onError(originalError);
      }
    }

    function cleanupRecording() {
      mediaRecorder = null;
      chunks = [];
    }

    function cleanupStream() {
      if (stream) {
        try {
          var tracks = stream.getTracks ? stream.getTracks() : [];
          for (var i = 0; i < tracks.length; i++) {
            if (tracks[i].stop) tracks[i].stop();
          }
        } catch (e) { /* ignore */ }
        stream = null;
      }
    }

    // --- Return public API -------------------------------------------------
    return {
      start: start,
      stop: stop,
      destroy: destroy,
      getState: getState,
      isSupported: isSupported,
      getMimeType: getMimeType,
      getSpeechRecognition: getSpeechRecognition,
    };
  }

  // Export for CommonJS (tests) and browser global
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createMicrophoneController: createMicrophoneController, isMediaRecorderSupported: isMediaRecorderSupported };
  } else if (root) {
    root.createMicrophoneController = createMicrophoneController;
  }
})(typeof globalThis !== 'undefined' ? globalThis : (typeof window !== 'undefined' ? window : null));
