"use server";

import { defineAction } from "@/server/operations";
import { archiveFileOperation, updateFileOperation } from "./operations";

const pages = ["/files", "/vehicles", "/orders"];

/** Beschriftung und Art einer Datei ändern. */
export const updateFile = defineAction(updateFileOperation, { revalidate: pages, message: "common.saved" });

/** Datei entfernen (archivieren): sie verschwindet aus Listen und Auslieferung, die Datei selbst bleibt unverändert. */
export const archiveFile = defineAction(archiveFileOperation, { revalidate: pages, message: "files.notices.removed" });
