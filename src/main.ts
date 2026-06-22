import { Plugin, requestUrl } from "obsidian";
import { ICSettings, DEFAULT_SETTINGS, ICSettingTab } from "./settings";
import { renderCalendar, renderAgenda, RenderCtx } from "./render";
import { FetchFn } from "./ics";

export default class IntegratedCalendarPlugin extends Plugin {
  settings: ICSettings;
  private icsCache: Record<string, { ts: number; text: string }> = {};

  async onload() {
    await this.loadSettings();

    const fetchFn: FetchFn = async (url: string) => {
      const ttl = (this.settings.cacheMinutes || 0) * 60 * 1000;
      const c = this.icsCache[url];
      const now = Date.now();
      if (ttl > 0 && c && now - c.ts < ttl) return c.text;
      const res = await requestUrl({ url, method: "GET" });
      this.icsCache[url] = { ts: now, text: res.text };
      return res.text;
    };

    this.registerMarkdownCodeBlockProcessor("calendar", async (source, el) => {
      await renderCalendar(el, this.ctx(fetchFn), (source || "").trim() || undefined);
    });

    this.registerMarkdownCodeBlockProcessor("calendar-agenda", async (source, el) => {
      await renderAgenda(el, this.ctx(fetchFn), (source || "").trim() || "today");
    });

    this.addSettingTab(new ICSettingTab(this.app, this));

    this.addCommand({
      id: "clear-ics-cache",
      name: "구독 캐시 비우고 새로고침",
      callback: () => {
        this.icsCache = {};
        // 열린 미리보기를 다시 그리도록 강제
        this.app.workspace.trigger("integrated-calendar:refresh");
        // 현재 활성 마크다운 뷰 리렌더
        // @ts-ignore
        this.app.workspace.activeLeaf?.rebuildView?.();
      },
    });
  }

  ctx(fetchFn: FetchFn): RenderCtx {
    return { app: this.app, settings: this.settings, fetch: fetchFn };
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
