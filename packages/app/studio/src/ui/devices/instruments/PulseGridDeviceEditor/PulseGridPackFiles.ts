import {Procedure} from "@opendaw/lib-std"

// Where a downloaded pack comes from, read from the browser's drop and file picker. The zips are opened here and the
// folders walked; nothing is decoded yet (PulseGridPackRun does that). SPEC.md, section 13.

export type PulseGridPackFile = {path: string, read(): Promise<ArrayBuffer>}
// One pack: a zip, a dropped folder, or the loose files of one drop.
export type PulseGridPackGroup = {zip?: string, source: string, files: ReadonlyArray<PulseGridPackFile>}

const AudioAccept = ".zip,.wav,.mp3,.ogg,.flac,.m4a,.aif,.aiff,audio/*"
const isZip = (name: string): boolean => /\.zip$/i.test(name)

const ofZip = async (name: string, data: ArrayBuffer): Promise<PulseGridPackGroup> => {
    const {default: JSZip} = await import("jszip")
    const zip = await JSZip.loadAsync(data)
    const files = Object.values(zip.files).filter(entry => !entry.dir)
        .map(entry => ({path: entry.name, read: () => entry.async("arraybuffer")}))
    return {zip: name, source: name, files}
}

const ofFile = (file: File, path: string): PulseGridPackFile => ({path, read: () => file.arrayBuffer()})

const readBatch = (reader: FileSystemDirectoryReader): Promise<Array<FileSystemEntry>> =>
    new Promise((resolve, reject) => reader.readEntries(entries => resolve(entries), reject))

const fileOf = (entry: FileSystemFileEntry): Promise<File> => new Promise((resolve, reject) => entry.file(resolve, reject))

const walk = async (entry: FileSystemEntry, path: string, out: Array<PulseGridPackFile>): Promise<void> => {
    if (entry.isFile) {
        out.push(ofFile(await fileOf(entry as FileSystemFileEntry), path))
        return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (let batch = await readBatch(reader); batch.length > 0; batch = await readBatch(reader)) {
        for (const child of batch) {await walk(child, `${path}/${child.name}`, out)}
    }
}

export namespace PulseGridPackFiles {
    // Every zip is a pack, every dropped folder is a pack, all the loose files together are one more.
    const groups = async (items: ReadonlyArray<{name: string, file?: File, entry?: FileSystemEntry}>):
        Promise<ReadonlyArray<PulseGridPackGroup>> => {
        const out: Array<PulseGridPackGroup> = []
        const loose: Array<PulseGridPackFile> = []
        for (const {name, file, entry} of items) {
            if (entry !== undefined && entry.isDirectory) {
                const files: Array<PulseGridPackFile> = []
                await walk(entry, name, files)
                out.push({source: name, files})
            } else if (file !== undefined && isZip(name)) {
                out.push(await ofZip(name, await file.arrayBuffer()))
            } else if (file !== undefined) {
                loose.push(ofFile(file, name))
            }
        }
        return loose.length > 0 ? [...out, {source: "", files: loose}] : out
    }

    // The files of a file picker.
    export const fromFiles = (files: FileList | ReadonlyArray<File>): Promise<ReadonlyArray<PulseGridPackGroup>> =>
        groups(Array.from(files).map(file => ({name: file.name, file})))

    // What was dropped. The entries must be taken before the first `await`: the browser empties them afterwards.
    export const fromDrop = (data: DataTransfer): Promise<ReadonlyArray<PulseGridPackGroup>> => {
        const entries = Array.from(data.items ?? []).filter(item => item.kind === "file")
            .map(item => ({file: item.getAsFile() ?? undefined, entry: item.webkitGetAsEntry() ?? undefined}))
        if (entries.length === 0 || entries.every(({entry}) => entry === undefined)) {return fromFiles(data.files)}
        return groups(entries.flatMap(({file, entry}) => {
            const name = entry?.name ?? file?.name
            return name === undefined ? [] : [{name, file: entry?.isFile === false ? undefined : file, entry}]
        }))
    }

    // Opens the browser's file picker (several files at once) and hands over what was chosen.
    export const pick = (chosen: Procedure<FileList>): void => {
        const input = document.createElement("input")
        input.type = "file"
        input.multiple = true
        input.accept = AudioAccept
        input.addEventListener("change", () => {
            if (input.files !== null && input.files.length > 0) {chosen(input.files)}
        })
        input.click()
    }
}
