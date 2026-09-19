# Frozen original-D room mathematics; x front, y left, z up.
from pathlib import Path
import h5py
import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt
from .near_field import near_field_firs

FS = 48000

def vector(azimuth, elevation=0.):
    az, el = np.deg2rad([azimuth, elevation])
    return np.array([np.cos(az)*np.cos(el), np.sin(az)*np.cos(el), np.sin(el)])


def angles(v):
    return float(np.rad2deg(np.arctan2(v[1], v[0]))), float(np.rad2deg(np.arctan2(v[2], np.hypot(v[0], v[1]))))


def distance_gain(r):
    # Shared ASMR production curve. These are product gain anchors, NOT calibrated SPL.
    return np.interp(np.log(r), np.log([.14, .35, .65, 1.2, 2.5]), [1.12, 1., .82, .62, .35])


class Profile:
    def __init__(self, path):
        self.path = Path(path)
        with h5py.File(path, "r") as f:
            self.positions = np.asarray(f["SourcePosition"], dtype=float)
            self.ir = np.asarray(f["Data.IR"], dtype=float)
            rate = np.asarray(f["Data.SamplingRate"]).ravel()
            delay = np.asarray(f["Data.Delay"])
            self.receivers = np.asarray(f["ReceiverPosition"])
            pos_type = f["SourcePosition"].attrs.get("Type", b"spherical")
            units = f["SourcePosition"].attrs.get("Units", b"")
            view = np.asarray(f["ListenerView"], dtype=float)
            up = np.asarray(f["ListenerUp"], dtype=float)
        if (self.positions.ndim != 2 or self.positions.shape[1] != 3
                or self.ir.ndim != 3 or self.ir.shape[:2] != (len(self.positions), 2)
                or not 1 <= self.ir.shape[2] <= 4096
                or not np.isfinite(self.positions).all() or not np.isfinite(self.ir).all()
                or not np.any(self.ir)):
            raise ValueError("Expected finite Mx3 directions and Mx2xN non-silent HRIRs.")
        receivers = np.squeeze(self.receivers)
        if (receivers.shape != (2, 3) or not np.isfinite(receivers).all()
                or not receivers[0, 1] > 0 > receivers[1, 1]
                or not np.allclose(receivers[:, [0, 2]], 0, atol=1e-8)
                or not np.allclose(receivers[0, 1], -receivers[1, 1], atol=1e-8)
                or view.shape != (1, 3) or up.shape != (1, 3)
                or not np.allclose(view, [1, 0, 0]) or not np.allclose(up, [0, 0, 1])):
            raise ValueError("SOFA must use x front/y left/z up and left-then-right ears on +/-y.")
        if isinstance(units, bytes):
            units = units.decode("ascii")
        if units.replace(" ", "").lower() != "degree,degree,metre":
            raise ValueError("SOFA source units must be degree, degree, metre.")
        if rate.size != 1 or rate[0] != FS or np.any(delay):
            raise ValueError("This experiment requires 48kHz SOFA with delays already in HRIR.")
        if pos_type not in (b"spherical", "spherical"):
            raise ValueError("Expected spherical SOFA coordinates.")
        radii = np.unique(self.positions[:, 2])
        if len(radii) != 1:
            raise ValueError("This harness expects a single measured radius; do not silently discard distance.")
        self.reference_distance = float(radii[0])
        self.head_radius = float(np.abs(self.receivers[:, 1]).mean())
        if self.reference_distance < .14 or not .05 <= self.head_radius <= .12:
            raise ValueError("Invalid measured distance or head radius.")
        self.directions = np.array([vector(*p[:2]) for p in self.positions])
        front = self.raw(0., 0.)
        spectrum = np.fft.rfft(front, n=2048, axis=1)
        freqs = np.fft.rfftfreq(2048, 1/FS)
        band = (freqs >= 200) & (freqs <= 12000)
        # One shared scalar for every angle, distance and ear; no per-ear normalization.
        self.calibration = 1 / np.sqrt(np.mean(np.sum(np.abs(spectrum[:, band])**2, axis=0)))

    def raw(self, az, el):
        index = int(np.argmax(self.directions @ vector(az, el)))
        return self.ir[index].copy()

    def hrir(self, az, el):
        return self.raw(az, el) * self.calibration


def diffuse_tail():
    rng = np.random.default_rng(20260913)
    n = round(.42*FS)
    t = np.arange(n)/FS
    result = rng.normal(size=(2, n))
    result = sosfilt(butter(2, 4300, fs=FS, output="sos"), result, axis=1)
    # RT60 0.28 s, smooth first 20ms; relative onset handled by room_ir.
    result *= np.exp(-np.log(1000)*t/.28) * np.minimum(t/.02, 1)[None, :]
    result /= np.sqrt(np.sum(result**2))
    return result


TAIL = diffuse_tail()


def direct_ir(profile, method, az, r):
    if method == "baseline":
        pan = -np.sin(np.deg2rad(az))
        theta = (pan+1)*np.pi/4
        return np.array([[np.cos(theta)], [np.sin(theta)]]) * distance_gain(r)
    h = profile.hrir(az, 0.)
    if method in ("nearfield", "room"):
        dvf = near_field_firs(az, 0., r, profile.reference_distance, FS, head_radius_m=profile.head_radius)
        h = np.array([fftconvolve(h[e], dvf[e]) for e in range(2)])
    return h * distance_gain(r)


def room_ir(profile, az, r):
    dry = direct_ir(profile, "nearfield", az, r)
    h = np.zeros((2, round(.65*FS)))
    h[:, :dry.shape[1]] = dry
    room = np.array([6., 6., 2.7])
    listener = np.array([2., 2., 1.2])
    source = listener + r*vector(az)
    if np.any(source <= 0) or np.any(source >= room):
        raise ValueError("Source outside the defined room.")
    reflection_energies = []
    delays = []
    for axis in range(3):
        for wall in (0., room[axis]):
            mirrored = source.copy()
            mirrored[axis] = 2*wall-source[axis]
            path = mirrored-listener
            length = np.linalg.norm(path)
            ref_az, ref_el = angles(path)
            reflection = profile.hrir(ref_az, ref_el)
            reflection = sosfilt(butter(1, 6500, fs=FS, output="sos"), reflection, axis=1)
            # Relative path law r/L; direct level uses the same bounded creative curve as A/B/C.
            reflection *= distance_gain(r)*.55*r/length
            delay = (length-r)/343*FS
            integer, fraction = int(delay), delay-int(delay)
            taps = reflection.shape[1]
            h[:, integer:integer+taps] += reflection*(1-fraction)
            h[:, integer+1:integer+taps+1] += reflection*fraction
            reflection_energies.append(float(np.sum(reflection**2)))
            delays.append(float(delay/FS))
    # Statistical late component, not a measured BRIR or an exact room solver.
    tail_start = round((max(delays)+.012)*FS)
    diffuse_gain = .72*np.sqrt(sum(reflection_energies))
    h[:, tail_start:tail_start+TAIL.shape[1]] += TAIL*diffuse_gain
    return h
