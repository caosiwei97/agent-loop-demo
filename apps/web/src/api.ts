export interface CaseContent {
  knowledge: boolean;
  diagram: boolean;
  interactive: boolean;
  mindmap: boolean;
  excalidraw: boolean;
}

export interface CaseData {
  id: string;
  title: string;
  group: string;
  description: string;
  entryFile: string;
  files: string[];
  content: CaseContent;
  section: string;
}

export interface ConsoleLine {
  type: "stdout" | "stderr" | "info" | "exit-ok" | "exit-err";
  text: string;
}

export async function fetchCases(): Promise<CaseData[]> {
  const res = await fetch("/api/cases");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchFile(path: string): Promise<string> {
  const res = await fetch(`/api/file/${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchExcalidraw(
  type: "overview" | "case",
  caseId?: string,
): Promise<Record<string, unknown>> {
  const url =
    type === "overview"
      ? "/api/excalidraw/overview"
      : `/api/excalidraw/cases/${caseId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function runCase(
  caseId: string,
  code: string,
  onLine: (line: ConsoleLine) => void,
  onDone: (exitCode: number) => void,
  signal?: AbortSignal,
): void {
  fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caseId, code }),
    signal,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const body = res.body;
      if (!body) throw new Error("No response body");
      const reader = body.getReader();

      const decoder = new TextDecoder();
      let buffer = "";

      function pump(): void {
        reader
          .read()
          .then((result) => {
            if (result.done) {
              onDone(0);
              return;
            }

            buffer += decoder.decode(result.value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const ln of lines) {
              if (!ln.startsWith("data: ")) continue;
              try {
                const msg = JSON.parse(ln.slice(6));
                if (msg.type === "stdout") {
                  onLine({ type: "stdout", text: msg.data });
                } else if (msg.type === "stderr") {
                  onLine({ type: "stderr", text: msg.data });
                } else if (msg.type === "exit") {
                  const exitCode =
                    typeof msg.data === "string"
                      ? (JSON.parse(msg.data).code ?? 0)
                      : (msg.code ?? 0);
                  onDone(exitCode);
                  return;
                }
              } catch {
                // skip malformed SSE lines
              }
            }

            pump();
          })
          .catch((err: Error) => {
            if (err.name === "AbortError") return;
            onLine({ type: "stderr", text: `Stream error: ${err.message}` });
            onDone(1);
          });
      }

      pump();
    })
    .catch((err: Error) => {
      if (err.name === "AbortError") {
        onLine({ type: "info", text: "运行已停止" });
      } else {
        onLine({ type: "stderr", text: `Request failed: ${err.message}` });
      }
      onDone(1);
    });
}
