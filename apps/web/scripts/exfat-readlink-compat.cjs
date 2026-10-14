// Windows exFAT returns EISDIR for readlink of a verified ordinary file/directory;
// Next/NFT expects EINVAL. Normalize only that error, preserving real links,
// missing files and all other errors. No asset-byte changes.
const fs = require('node:fs');
if (process.platform === 'win32') {
  const originalSync = fs.readlinkSync.bind(fs);
  const originalCallback = fs.readlink.bind(fs);
  const originalPromise = fs.promises.readlink.bind(fs.promises);
  const originalLstatSync = fs.lstatSync.bind(fs);
  const originalLstat = fs.promises.lstat.bind(fs.promises);
  const normalize = error => { error.code = 'EINVAL'; error.errno = -22; return error; };
  const ordinary = info => !info.isSymbolicLink() && (info.isFile() || info.isDirectory());
  const regularSync = p => { try { return ordinary(originalLstatSync(p)); } catch { return false; } };
  const regular = async p => { try { return ordinary(await originalLstat(p)); } catch { return false; } };
  fs.readlinkSync = function(p, options) {
    try { return originalSync(p, options); }
    catch (error) { if (error.code === 'EISDIR' && regularSync(p)) normalize(error); throw error; }
  };
  fs.promises.readlink = async function(p, options) {
    try { return await originalPromise(p, options); }
    catch (error) { if (error.code === 'EISDIR' && await regular(p)) normalize(error); throw error; }
  };
  fs.readlink = function(p, options, callback) {
    if (typeof options === 'function') { callback = options; options = undefined; }
    return originalCallback(p, options, async (error, value) => {
      if (error?.code === 'EISDIR' && await regular(p)) normalize(error);
      callback(error, value);
    });
  };
}
