import path from "path";
import { BinaryFile, FilesToUpload, MarkdownFile } from ".";
import { lookup } from "mime-types";
import matter, { stringify } from "gray-matter";
import {
	ConfluencePerPageAllValues,
	ConfluencePerPageConfig,
	conniePerPageConfig,
} from "../ConniePageConfig";
import { ConfluenceSettings } from "../Settings";

export class FileSystemAdaptor {
	settings: ConfluenceSettings;

	constructor(settings: ConfluenceSettings) {
		this.settings = settings;

		if (!window || !window.fetch) {
			throw new Error("The 'fetch' function is not available.");
		}

		if (!settings.contentRoot || !document || !document.getElementById) {
			throw new Error(
				"The 'contentRoot' or 'document' is not available."
			);
		}
	}

	async getFileContent(absoluteFilePath: any) {
		const response = await fetch(absoluteFilePath);
		const fileContent = await response.text();

		const { data, content } = matter(fileContent);
		return { data, content };
	}

	async updateMarkdownValues(
		absoluteFilePath: string,
		values: Partial<ConfluencePerPageAllValues>
	): Promise<void> {
		const actualAbsoluteFilePath = new URL(
			absoluteFilePath,
			this.settings.contentRoot
		);

		try {
			const response = await fetch(actualAbsoluteFilePath);
			if (!response.ok || response.status === 404) {
				return;
			}
		} catch (error) {
			console.warn(
				"updateMarkdownValues:",
				JSON.stringify({
					actualAbsoluteFilePath,
					absoluteFilePath,
					contentRoot: this.settings.contentRoot,
					errorMessage: "",
				})
			);
			return;
		}

		const fileContent = await this.getFileContent(actualAbsoluteFilePath);

		const config = conniePerPageConfig;

		const fm: { [key: string]: unknown } = {};
		for (const propertyKey in config) {
			if (!config.hasOwnProperty(propertyKey)) {
				continue;
			}

			const { key } =
				config[propertyKey as keyof ConfluencePerPageConfig];
			const value =
				values[propertyKey as keyof ConfluencePerPageAllValues];
			if (propertyKey in values) {
				if (value) {
					fm[key] = value;
				} else {
					if (key in fileContent.data) {
						delete fileContent.data[key];
					}
				}
			}
		}

		const updatedData = stringify(fileContent, fm);

		const requestOptions = {
			method: "PUT",
			headers: { "Content-Type": "text/markdown" },
			body: updatedData,
		};

		await fetch(actualAbsoluteFilePath, requestOptions);
	}

	async loadMarkdownFile(absoluteFilePath: string): Promise<MarkdownFile> {
		const { data, content: contents } = await this.getFileContent(
			absoluteFilePath
		);

		const folderName = path.basename(path.parse(absoluteFilePath).dir);
		const fileName = path.basename(absoluteFilePath);

		const extension = path.extname(fileName);
		const pageTitle = path.basename(fileName, extension);

		return {
			folderName,
			absoluteFilePath: absoluteFilePath.replace(
				this.settings.contentRoot,
				""
			),
			fileName,
			pageTitle,
			contents,
			frontmatter: data,
		};
	}

	async loadMarkdownFiles(folderPath: string): Promise<MarkdownFile[]> {
		const files: MarkdownFile[] = [];

		try {
			const response = await fetch(folderPath);
			if (!response.ok || response.status === 404) {
				return files;
			}

			const entries = await response.json();

			for (const entry of entries) {
				const absoluteFilePath = new URL(
					entry.name,
					this.settings.contentRoot
				).toString();

				if (entry.isFile && path.extname(entry.name) === ".md") {
					const file = await this.loadMarkdownFile(absoluteFilePath);
					files.push(file);
				} else if (entry.isDirectory) {
					const subFiles = await this.loadMarkdownFiles(
						absoluteFilePath
					);
					files.push(...subFiles);
				}
			}
		} catch (error) {
			console.warn(
				"loadMarkdownFiles:",
				JSON.stringify({
					folderPath,
					contentRoot: this.settings.contentRoot,
					errorMessage: "",
				})
			);
		}

		return files;
	}

	async getMarkdownFilesToUpload(): Promise<FilesToUpload> {
		const files = await this.loadMarkdownFiles(this.settings.contentRoot);
		const filesToPublish = [];
		for (const file of files) {
			try {
				const frontMatter = file.frontmatter;

				if (
					((file.absoluteFilePath.startsWith(
						this.settings.folderToPublish
					) ||
						this.settings.folderToPublish === ".") &&
						(!frontMatter ||
							frontMatter["connie-publish"] !== false)) ||
					(frontMatter && frontMatter["connie-publish"] === true)
				) {
					filesToPublish.push(file);
				}
			} catch {
				// ignore
			}
		}
		return filesToPublish;
	}

	async readBinary(
		searchPath: string,
		referencedFromFilePath: string
	): Promise<BinaryFile | false> {
		const absoluteFilePath = new URL(
			searchPath,
			this.settings.contentRoot
		).toString();

		try {
			const response = await fetch(absoluteFilePath);
			if (!response.ok || response.status === 404) {
				return false;
			}

			const fileContents = await response.arrayBuffer();

			const mimeType =
				lookup(path.extname(absoluteFilePath)) ||
				"application/octet-stream";
			return {
				contents: fileContents,
				filePath: absoluteFilePath.replace(
					this.settings.contentRoot,
					""
				),
				filename: path.basename(absoluteFilePath),
				mimeType: mimeType,
			};
		} catch (error) {
			console.warn(
				"readBinary:",
				JSON.stringify({
					searchPath,
					referencedFromFilePath,
					contentRoot: this.settings.contentRoot,
					errorMessage: "",
				})
			);
			return false;
		}
	}
}
