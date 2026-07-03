import { Notice, Plugin, requestUrl } from "obsidian";
import { ICSettings, DEFAULT_SETTINGS, ICSettingTab } from "./settings";
import { renderCalendar, renderAgenda, RenderCtx } from "./render";
import { renderTasks } from "./tasks";
import { FetchFn } from "./ics";
import { clearJiraCache } from "./jira";

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

    this.registerMarkdownCodeBlockProcessor("integrated-tasks", async (_source, el) => {
      await renderTasks(el, { app: this.app, settings: this.settings });
    });

    this.addSettingTab(new ICSettingTab(this.app, this));

    this.addCommand({
      id: "clear-ics-cache",
      name: "구독·Jira 캐시 비우기",
      callback: () => {
        this.icsCache = {};
        clearJiraCache();
        new Notice("Integrated Calendar: 구독·Jira 캐시를 비웠습니다. 노트를 다시 열면 새로 받아옵니다.");
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
