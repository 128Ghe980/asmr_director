"""Second-order shoebox images + a short, stable feedback-delay-network tail.

Independent experiment, not an implementation of SDN or a measured BRIR. Wall
coefficients and the FDN decay are artistic presets, not measured materials.
"""
from functools import lru_cache
from itertools import product

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

from render import FS, TAIL, angles, direct_ir, distance_gain, vector
from near_field import near_field_firs

ROOM = np.array([6., 6., 2.7])
LISTENER = np.array([2., 2., 1.2])
# Pressure reflection factor, then low-pass corner: x-/x+/y-/y+/floor/ceiling.
# Softer front/side surfaces, a more reflective floor. No measured-material claim.
WALLS = [(0.48, 4100), (0.52, 4700), (0.42, 3500),
         (0.50, 4300), (0.58, 6000), (0.45, 4000)]
FDN_DELAYS = np.array([809, 887, 1013, 1129, 1277, 1429, 1601, 1789])


def image_paths(source, order=2):
    """Unique rectangular-room image sources with an exact reflection count.

    S*s+t is the image isometry. Its inverse maps the image-to-listener ray
    back to the actual emitted ray, which is needed for source directivity.
    """
    source = np.asarray(source, float)
    for ns in product(range(-1, 2), repeat=3):
        for ps in product((0, 1), repeat=3):
            counts = np.abs(2*np.asarray(ns)-np.asarray(ps))
            total = int(sum(counts))
            if not 1 <= total <= order:
                continue
            signs = (-1.)**np.asarray(ps)
            image = 2*np.asarray(ns)*ROOM + signs*source
            path = image-LISTENER
            length = float(np.linalg.norm(path))
            hits = []
            for axis, count in enumerate(counts):
                lower = upper = int(count)//2
                if count % 2:
                    if ns[axis] <= 0:
                        lower += 1
                    else:
                        upper += 1
                hits.extend([2*axis]*lower + [2*axis+1]*upper)
            yield dict(path=path, length=length, emission=-signs*path/length,
                       walls=hits, order=total)


@lru_cache(maxsize=4)
def fdn_tail(rt60=.24):
    """Eight delay lines, orthogonal Householder feedback and loop damping.

    Per-loop gains are below one; the one-pole filter has gain <=1, so the
    network is contractive. rt60 is a low-frequency design target; damping
    makes high frequencies decay sooner. The finite stereo IR is cached.
    """
    n = round(.50*FS)
    lines = np.zeros((8, int(max(FDN_DELAYS))))
    pos = np.zeros(8, dtype=int)
    gain = 10**(-3*FDN_DELAYS/(FS*rt60))
    pole = np.exp(-2*np.pi*5700/FS)
    damped = np.zeros(8)
    injection = np.array([1, -1, 1, 1, -1, 1, -1, -1])/np.sqrt(8)
    readout = np.array([[1, 1, -1, 1, -1, -1, 1, -1],
                        [1, -1, -1, -1, 1, -1, 1, 1]])/np.sqrt(8)
    out = np.zeros((2, n))
    idx = np.arange(8)
    for t in range(n):
        y = lines[idx, pos]
        out[:, t] = readout @ y
        damped = (1-pole)*y + pole*damped
        feedback = damped - .25*np.sum(damped)  # I - 2 vv^T, v=ones/sqrt(8)
        lines[idx, pos] = feedback*gain + (injection if t == 0 else 0.)
        pos = (pos+1) % FDN_DELAYS
    # Remove the initial empty delay: room_ir determines the late onset.
    out = out[:, int(min(FDN_DELAYS)):]
    out[:, :960] *= np.sin(np.linspace(0, np.pi/2, 960))**2
    out[:, -720:] *= np.linspace(1, 0, 720)
    out /= np.sqrt(np.sum(out**2))
    return out


def convolve_stereo(h, fir):
    return np.array([fftconvolve(ear, fir) for ear in h])


def add_delayed(output, h, delay_samples):
    if delay_samples < 0:
        raise ValueError("Reflection cannot precede its direct path")
    start = int(delay_samples)
    fraction = delay_samples-start
    for offset, gain in ((0, 1-fraction), (1, fraction)):
        count = min(h.shape[1], output.shape[1]-start-offset)
        if count > 0:
            output[:, start+offset:start+offset+count] += h[:, :count]*gain


def refined_ir(profile, geometry, az, r, *, room_refined, source_geometry,
               voice, yaw_offset_deg=0., return_components=False):
    from source_geometry import directivity_fir

    source = LISTENER + r*vector(az)
    if np.any(source <= 0) or np.any(source >= ROOM):
        raise ValueError("Source outside room")
    facing = vector(az+180+yaw_offset_deg)
    if source_geometry:
        h = geometry.hrir(az, 0., r)
        dvf = near_field_firs(az, 0., r, profile.reference_distance, FS,
                             head_radius_m=profile.head_radius)
        direct_parts = []
        for ear in range(2):
            part = fftconvolve(h[ear], dvf[ear])
            if voice:
                ear_pos = np.asarray(profile.receivers[ear]).reshape(3, -1)[:, 0]
                ray = ear_pos-r*vector(az)
                cosine = float(np.clip(np.dot(facing, ray/np.linalg.norm(ray)), -1, 1))
                part = fftconvolve(part, directivity_fir(cosine, FS))
            direct_parts.append(part)
        direct = np.array(direct_parts)*distance_gain(r)
    else:
        direct = direct_ir(profile, "nearfield", az, r)
        direct = np.pad(direct, ((0, 0), (geometry.latency_samples, 0)))
    early = np.zeros((2, round(.65*FS)))
    energies, delays = [], []
    for item in image_paths(source, 2 if room_refined else 1):
        reflection = profile.hrir(*angles(item["path"]))
        if room_refined:
            for wall in item["walls"]:
                coefficient, cutoff = WALLS[wall]
                reflection = sosfilt(butter(1, cutoff, fs=FS, output="sos"), reflection, axis=1)*coefficient
        else:
            reflection = sosfilt(butter(1, 6500, fs=FS, output="sos"), reflection, axis=1)*.55
        if source_geometry and voice:
            cosine = float(np.clip(np.dot(facing, item["emission"]), -1, 1))
            reflection = convolve_stereo(reflection, directivity_fir(cosine, FS))
        reflection *= distance_gain(r)*r/item["length"]
        delay = (item["length"]-r)/343*FS
        add_delayed(early, reflection, delay+geometry.latency_samples)
        energies.append(float(np.sum(reflection**2)))
        delays.append(delay/FS)
    late = np.zeros_like(early)
    if room_refined:
        tail, scale = fdn_tail(), .52
        start = round(.035*FS)
    else:
        tail, scale = TAIL, .72
        start = round((max(delays)+.012)*FS)
    start += geometry.latency_samples
    late[:, start:start+tail.shape[1]] = tail*scale*np.sqrt(sum(energies))
    out = early+late
    out[:, :direct.shape[1]] += direct
    if return_components:
        return out, direct, early, late
    return out
