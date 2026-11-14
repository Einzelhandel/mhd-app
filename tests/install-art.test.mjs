import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installArt, istIos } from '../docs/install-art.js';

test('installArt', () => {
  assert.equal(installArt({ installiert: true, kannFragen: true, ios: true }), null);
  assert.equal(installArt({ installiert: false, kannFragen: true, ios: false }), 'knopf');
  assert.equal(installArt({ installiert: false, kannFragen: false, ios: true }), 'ios');
  assert.equal(installArt({ installiert: false, kannFragen: false, ios: false }), 'menue');
});

test('istIos', () => {
  assert.equal(istIos('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5), true);
  assert.equal(istIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), true);
  assert.equal(istIos('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), false);
  assert.equal(istIos('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5), false);
  assert.equal(istIos('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0), false);
});
