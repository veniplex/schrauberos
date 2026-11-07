/**
 * Testbilder für die Bereinigung und die Datei-Uploads (nur in Tests): strukturell vollständige JPEGs mit Exif (Ausrichtung, Make als Geheimnis), XMP, IPTC, Kommentar, Vorschaubild und Anhängseln.
 */

export const SECRET = "SECRET-GPS-48.137N-11.575E";

export const seg = (marker: number, payload: Buffer) => {
  const head = Buffer.from([0xff, marker, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([head, payload]);
};

/** TIFF mit Ausrichtung und einem Geheimnis (Make) – wie ein Handyfoto mit Ortsangabe. */
export function tiffWith(orientation: number, little = true): Buffer {
  const secret = Buffer.from(`${SECRET}\0`, "latin1");
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + secret.length);
  const w16 = (v: number, at: number) => (little ? tiff.writeUInt16LE(v, at) : tiff.writeUInt16BE(v, at));
  const w32 = (v: number, at: number) => (little ? tiff.writeUInt32LE(v, at) : tiff.writeUInt32BE(v, at));
  tiff.write(little ? "II" : "MM", 0, "latin1");
  w16(42, 2);
  w32(8, 4);
  w16(2, 8);
  w16(0x010f, 10); // Make (ASCII)
  w16(2, 12);
  w32(secret.length, 14);
  w32(8 + 2 + 24 + 4, 18);
  w16(0x0112, 22); // Orientation
  w16(3, 24);
  w32(1, 26);
  w16(orientation, 30);
  secret.copy(tiff, 8 + 2 + 24 + 4);
  return tiff;
}

/** Ein kleinstes gültiges ICC-Profil (128-Byte-Kopf mit Größe und „acsp“, keine Tags) – nur Tests. */
export function iccProfile(extra = 0): Buffer {
  const profile = Buffer.alloc(132 + extra);
  profile.writeUInt32BE(profile.length, 0);
  profile.write("acsp", 36, "latin1");
  return profile;
}

export type JpegOptions = { exif?: Buffer; comment?: boolean; iptc?: boolean; icc?: boolean; adobe?: boolean; trailing?: boolean; width?: number; height?: number; thumbnail?: boolean; truncate?: boolean; noScan?: boolean; mpf?: boolean };

export function jpeg(o: JpegOptions = {}): Buffer {
  const width = o.width ?? 8;
  const height = o.height ?? 4;
  const jfif = Buffer.concat([Buffer.from("JFIF\0", "latin1"), Buffer.from([1, 1, 0, 0, 1, 0, 1, o.thumbnail ? 2 : 0, o.thumbnail ? 1 : 0]), o.thumbnail ? Buffer.from(SECRET.slice(0, 6), "latin1") : Buffer.alloc(0)]);
  const sof = Buffer.from([8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const dht = Buffer.concat([Buffer.from([0x00, 1, ...new Array(15).fill(0)]), Buffer.from([0])]);
  const sos = Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const parts = [Buffer.from([0xff, 0xd8]), seg(0xe0, jfif)];
  if (o.exif) parts.push(seg(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), o.exif])));
  parts.push(seg(0xe1, Buffer.from(`http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>${SECRET}</x:xmpmeta>`, "latin1")));
  if (o.iptc) parts.push(seg(0xed, Buffer.from(`Photoshop 3.0\0${SECRET}`, "latin1")));
  if (o.mpf) parts.push(seg(0xe2, Buffer.from(`MPF\0${SECRET}`, "latin1")));
  if (o.icc) parts.push(seg(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.concat([Buffer.from([1, 1]), iccProfile()])])));
  if (o.adobe) parts.push(seg(0xee, Buffer.from("Adobe\0\x64\0\0\0\0\x01", "latin1")));
  if (o.comment) parts.push(seg(0xfe, Buffer.from(SECRET, "latin1")));
  parts.push(seg(0xdb, Buffer.concat([Buffer.from([0]), Buffer.alloc(64, 16)])), seg(0xc0, sof), seg(0xc4, dht));
  if (!o.noScan) parts.push(seg(0xda, sos), Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56, 0xff, 0xd0, 0x78]));
  if (!o.truncate) parts.push(Buffer.from([0xff, 0xd9]));
  if (o.trailing) parts.push(Buffer.from(`<?php ${SECRET} ?>`, "latin1"));
  return Buffer.concat(parts);
}

