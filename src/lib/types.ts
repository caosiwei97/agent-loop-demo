export interface CaseContent {
  knowledge: boolean;
  diagram: boolean;
  interactive: boolean;
  mindmap: boolean;
  excalidraw: boolean;
}

export interface CaseListItem {
  id: string;
  title: string;
  group: string;
  description: string;
  section: string;
  content: CaseContent;
  files: string[];
}

export interface FullCaseData extends CaseListItem {
  indexSource: string;
  knowledgeMd: string | null;
  diagramMmd: string | null;
  diagramHtml: string | null;
  mindmapMd: string | null;
  interactiveHtml: string | null;
  excalidrawScene: Record<string, unknown> | null;
}

export interface LibFileData {
  name: string;
  source: string;
}
