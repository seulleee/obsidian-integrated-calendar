import { App, Notice, PluginSettingTab, Setting, ButtonComponent } from "obsidian";
import type IntegratedCalendarPlugin from "./main";
import { getJiraIssues, clearJiraCache, DEFAULT_JQL } from "./jira";

export interface CalendarSource {
  name: string;
  color: string;
  icon: string;
  url: string;
  enabled: boolean;
}

export interface ICSettings {
  sources: CalendarSource[];
  localName: string;
  localColor: string;
  localIcon: string;
  eventFolder: string; // 로컬 일정 노트 폴더 (frontmatter 기반)
  taskGlobExclude: string; // 할일 스캔에서 제외할 폴더(쉼표구분)
  firstDayMonday: boolean;
  cacheMinutes: number;
  // 할일 대시보드(integrated-tasks)용
  projectFolder: string; // 프로젝트 노트 폴더
  inboxNote: string; // 빠른메모(인박스) 노트 경로
  taskSection: string; // 할일을 끼워 넣을 섹션 제목
  templateFolder: string; // 모든 버킷에서 제외할 템플릿 폴더
  // Jira 연동 (읽기 전용, Jira Cloud)
  jiraEnabled: boolean;
  jiraSite: string; // https://회사.atlassian.net
  jiraEmail: string; // Atlassian 계정 이메일
  jiraToken: string; // API 토큰 (data.json 에만 저장)
  jiraJql: string; // 가져올 이슈 JQL
}

export const DEFAULT_SETTINGS: ICSettings = {
  sources: [],
  localName: "내 일정",
  localColor: "#3a8bcd",
  localIcon: "🔵",
  eventFolder: "1. 일정",
  taskGlobExclude: "0. 템플릿",
  firstDayMonday: false,
  cacheMinutes: 10,
  projectFolder: "4. 프로젝트",
  inboxNote: "📥 빠른메모.md",
  taskSection: "## ✅ 할일",
  templateFolder: "0. 템플릿",
  jiraEnabled: false,
  jiraSite: "",
  jiraEmail: "",
  jiraToken: "",
  jiraJql: "assignee = currentUser() AND statusCategory != Done ORDER BY duedate",
};

const PALETTE = ["🔵", "🟠", "🟣", "🟢", "🔴", "🟡", "🟤", "⚫"];

export class ICSettingTab extends PluginSettingTab {
  plugin: IntegratedCalendarPlugin;

  constructor(app: App, plugin: IntegratedCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("p", {
      text: "구독 캘린더(iCloud / Outlook / Google 등 ICS 주소)와 노트 안의 일정·할일을 한 화면에 통합합니다.",
      cls: "setting-item-description",
    });

    // ---- 구독 캘린더 소스 ----
    new Setting(containerEl).setName("구독 캘린더").setHeading();

    const help = containerEl.createEl("details");
    help.createEl("summary", { text: "ICS 주소는 어디서 구하나요?" });
    const ul = help.createEl("ul");
    ul.createEl("li", { text: "iCloud: 캘린더 앱 → 캘린더 우클릭 → 공유 → '공개 캘린더' → webcal:// 주소 (앞을 https:// 로 바꾸세요)" });
    ul.createEl("li", { text: "Google: 캘린더 설정 → '캘린더 통합' → iCal 형식의 비공개 주소" });
    ul.createEl("li", { text: "Outlook: 설정 → 캘린더 → 공유 캘린더 → 캘린더 게시 → ICS 링크" });
    help.createEl("p", { text: "구독 캘린더는 읽기 전용입니다 (보기만 가능).", cls: "setting-item-description" });

    this.plugin.settings.sources.forEach((src, idx) => {
      const s = new Setting(containerEl)
        .addText((t) =>
          t.setPlaceholder("이름 (예: 회사)").setValue(src.name).onChange(async (v) => {
            src.name = v; await this.plugin.saveSettings();
          }))
        .addDropdown((d) => {
          PALETTE.forEach((emoji) => d.addOption(emoji, emoji));
          d.setValue(PALETTE.includes(src.icon) ? src.icon : "🟠").onChange(async (v) => {
            src.icon = v; await this.plugin.saveSettings();
          });
        })
        .addText((t) =>
          t.setPlaceholder("https://....ics").setValue(src.url).onChange(async (v) => {
            src.url = v.trim(); await this.plugin.saveSettings();
          }));
      // 색상
      const colorInput = s.controlEl.createEl("input", { type: "color", cls: "ic-color-input" });
      colorInput.value = src.color;
      colorInput.addEventListener("change", async () => { src.color = colorInput.value; await this.plugin.saveSettings(); });
      // 켜기/끄기
      s.addToggle((tg) => tg.setTooltip("표시 켜기/끄기").setValue(src.enabled).onChange(async (v) => {
        src.enabled = v; await this.plugin.saveSettings();
      }));
      // 삭제
      s.addExtraButton((b) => b.setIcon("trash").setTooltip("삭제").onClick(async () => {
        this.plugin.settings.sources.splice(idx, 1);
        await this.plugin.saveSettings();
        this.display();
      }));
    });

    new Setting(containerEl).addButton((b: ButtonComponent) =>
      b.setButtonText("+ 캘린더 추가").setCta().onClick(async () => {
        const icon = PALETTE[(this.plugin.settings.sources.length + 1) % PALETTE.length];
        const colorByIcon: any = { "🟠": "#ff8c42", "🟣": "#9b59b6", "🟢": "#2ecc71", "🔴": "#e74c3c", "🟡": "#f1c40f", "🟤": "#8d6e63", "⚫": "#555555", "🔵": "#3a8bcd" };
        this.plugin.settings.sources.push({ name: "", color: colorByIcon[icon] || "#ff8c42", icon, url: "", enabled: true });
        await this.plugin.saveSettings();
        this.display();
      }));

    // ---- 내 일정(로컬) ----
    new Setting(containerEl).setName("내 노트 일정").setHeading();
    new Setting(containerEl)
      .setName("일정 폴더")
      .setDesc("frontmatter(date/startTime…)로 일정을 적는 노트 폴더. 비우면 사용 안 함.")
      .addText((t) => t.setValue(this.plugin.settings.eventFolder).onChange(async (v) => {
        this.plugin.settings.eventFolder = v.trim(); await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("내 일정 표시 이름 / 색")
      .addText((t) => t.setValue(this.plugin.settings.localName).onChange(async (v) => {
        this.plugin.settings.localName = v; await this.plugin.saveSettings();
      }))
      .then((s) => {
        const c = s.controlEl.createEl("input", { type: "color", cls: "ic-color-input" });
        c.value = this.plugin.settings.localColor;
        c.addEventListener("change", async () => { this.plugin.settings.localColor = c.value; await this.plugin.saveSettings(); });
      });

    // ---- 할일 ----
    new Setting(containerEl).setName("할일").setHeading();
    new Setting(containerEl)
      .setName("할일 스캔 제외 폴더")
      .setDesc("쉼표로 구분. 이 폴더의 체크박스는 달력/아젠다에서 제외합니다.")
      .addText((t) => t.setValue(this.plugin.settings.taskGlobExclude).onChange(async (v) => {
        this.plugin.settings.taskGlobExclude = v; await this.plugin.saveSettings();
      }));

    // ---- 할일 대시보드 ----
    new Setting(containerEl).setName("할일 대시보드").setHeading();
    containerEl.createEl("p", {
      text: "```integrated-tasks``` 코드블록(빠른 등록·놓친 할일·해야 할 일·백로그·최근 완료)에서 쓰는 설정입니다.",
      cls: "setting-item-description",
    });
    new Setting(containerEl)
      .setName("프로젝트 폴더")
      .setDesc("빠른 등록의 프로젝트 칩이 이 폴더의 노트로 만들어집니다.")
      .addText((t) => t.setValue(this.plugin.settings.projectFolder).onChange(async (v) => {
        this.plugin.settings.projectFolder = v.trim(); await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("빠른메모(인박스) 노트")
      .setDesc("📥 빠른 메모 칩을 골랐을 때 할일이 들어가는 노트 경로.")
      .addText((t) => t.setValue(this.plugin.settings.inboxNote).onChange(async (v) => {
        this.plugin.settings.inboxNote = v.trim(); await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("할일 섹션 제목")
      .setDesc("새 할일을 끼워 넣을 섹션 제목. 없으면 노트/섹션을 자동으로 만듭니다.")
      .addText((t) => t.setValue(this.plugin.settings.taskSection).onChange(async (v) => {
        this.plugin.settings.taskSection = v.trim() || "## ✅ 할일"; await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("템플릿 폴더(대시보드 제외)")
      .setDesc("이 폴더의 할일은 대시보드의 모든 묶음에서 제외합니다.")
      .addText((t) => t.setValue(this.plugin.settings.templateFolder).onChange(async (v) => {
        this.plugin.settings.templateFolder = v.trim(); await this.plugin.saveSettings();
      }));

    // ---- Jira 연동 (읽기 전용) ----
    new Setting(containerEl).setName("Jira 연동 (읽기 전용)").setHeading();
    containerEl.createEl("p", {
      text: "Jira Cloud 에서 내게 할당된 이슈를 가져와 할일 대시보드(마감일 기준: 지난 기한 / 오늘 / 다가오는 2주)에 함께 보여줍니다. 보기 전용이며 Jira 를 수정하지 않습니다.",
      cls: "setting-item-description",
    });
    const jhelp = containerEl.createEl("details");
    jhelp.createEl("summary", { text: "API 토큰은 어디서 발급하나요?" });
    const jul = jhelp.createEl("ul");
    jul.createEl("li", { text: "id.atlassian.com → 계정 관리 → 보안 → 'API 토큰 만들기' 에서 발급" });
    jul.createEl("li", { text: "주소는 https://회사이름.atlassian.net 형식 (Jira Cloud)" });
    jul.createEl("li", { text: "토큰은 이 볼트의 플러그인 설정(data.json)에만 저장되며, 공유 템플릿에는 포함되지 않습니다." });

    new Setting(containerEl)
      .setName("Jira 사용")
      .setDesc("켜면 대시보드에 Jira 이슈가 함께 표시됩니다.")
      .addToggle((tg) => tg.setValue(this.plugin.settings.jiraEnabled).onChange(async (v) => {
        this.plugin.settings.jiraEnabled = v; await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("Jira 주소")
      .setDesc("예: https://mycompany.atlassian.net")
      .addText((t) => t.setPlaceholder("https://회사.atlassian.net").setValue(this.plugin.settings.jiraSite).onChange(async (v) => {
        this.plugin.settings.jiraSite = v.trim(); await this.plugin.saveSettings(); clearJiraCache();
      }));
    new Setting(containerEl)
      .setName("Atlassian 이메일")
      .addText((t) => t.setPlaceholder("you@company.com").setValue(this.plugin.settings.jiraEmail).onChange(async (v) => {
        this.plugin.settings.jiraEmail = v.trim(); await this.plugin.saveSettings(); clearJiraCache();
      }));
    new Setting(containerEl)
      .setName("API 토큰")
      .setDesc("id.atlassian.com 에서 발급. 이 볼트에만 저장됩니다.")
      .addText((t) => {
        t.setPlaceholder("••••••••").setValue(this.plugin.settings.jiraToken).onChange(async (v) => {
          this.plugin.settings.jiraToken = v.trim(); await this.plugin.saveSettings(); clearJiraCache();
        });
        t.inputEl.type = "password";
        t.inputEl.autocomplete = "off";
      });
    new Setting(containerEl)
      .setName("JQL")
      .setDesc("가져올 이슈 조건. 비우면 기본값(내게 할당된 미완료 이슈)을 사용합니다.")
      .addText((t) => t.setPlaceholder(DEFAULT_JQL).setValue(this.plugin.settings.jiraJql).onChange(async (v) => {
        this.plugin.settings.jiraJql = v; await this.plugin.saveSettings(); clearJiraCache();
      }));
    new Setting(containerEl)
      .setName("연결 테스트")
      .setDesc("현재 설정으로 Jira 에서 이슈를 가져와 봅니다.")
      .addButton((b: ButtonComponent) => b.setButtonText("연결 테스트").onClick(async () => {
        b.setDisabled(true); b.setButtonText("확인 중…");
        try {
          clearJiraCache();
          const issues = await getJiraIssues(this.plugin.settings, true);
          new Notice("✅ Jira 연결 성공 — 이슈 " + issues.length + "건을 가져왔습니다.");
        } catch (e: any) {
          new Notice("⚠️ Jira 연결 실패: " + (e?.message || e));
        } finally {
          b.setDisabled(false); b.setButtonText("연결 테스트");
        }
      }));

    // ---- 일반 ----
    new Setting(containerEl).setName("일반").setHeading();
    new Setting(containerEl)
      .setName("월요일 시작")
      .setDesc("끄면 일요일 시작.")
      .addToggle((tg) => tg.setValue(this.plugin.settings.firstDayMonday).onChange(async (v) => {
        this.plugin.settings.firstDayMonday = v; await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("구독 캐시(분)")
      .setDesc("구독 ICS를 다시 받기 전 캐시 유지 시간.")
      .addText((t) => t.setValue(String(this.plugin.settings.cacheMinutes)).onChange(async (v) => {
        const n = parseInt(v, 10); if (!isNaN(n) && n >= 0) { this.plugin.settings.cacheMinutes = n; await this.plugin.saveSettings(); }
      }));

    // ---- 사용법 ----
    new Setting(containerEl).setName("사용법").setHeading();
    const usage = containerEl.createDiv({ cls: "setting-item-description" });
    usage.createEl("p", { text: "노트에 아래 코드블록을 넣으면 달력/목록이 그려집니다:" });
    const pre1 = usage.createEl("pre"); pre1.createEl("code", { text: "```calendar\n```  →  월/주/일 전환 달력" });
    const pre2 = usage.createEl("pre"); pre2.createEl("code", { text: "```calendar-agenda today\n```  →  오늘 일정 목록" });
    const pre3 = usage.createEl("pre"); pre3.createEl("code", { text: "```calendar-agenda 14\n```  →  앞으로 14일 일정 목록" });
    const pre4 = usage.createEl("pre"); pre4.createEl("code", { text: "```integrated-tasks\n```  →  빠른 등록 + 할일 대시보드" });
  }
}
