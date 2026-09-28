/**
 * 炼墨学习进度打卡系统 v2
 * - visit：记录打开课程（首末日期、次数）
 * - autoTrack：全页自动埋点——凡是可点击处（按钮/选项/翻卡/链接）与可展开处（追问链/发散/提示）
 *   的每一次交互都记一次进度；quiz：答完全部自测题 = 完成打卡（含日期）
 * - 存储：浏览器 localStorage（按设备独立）；跨设备用导出/导入进度码搬运。
 */
(function () {
  var KEY = "lianmo_progress_v1";
  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function write(d) {
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  var LM = {
    visit: function (id) {
      var d = read(), r = d[id] || (d[id] = {});
      if (!r.first) r.first = today();
      r.last = today();
      r.visits = (r.visits || 0) + 1;
      write(d);
    },
    touch: function (id, key) {
      var d = read(), r = d[id] || (d[id] = {});
      if (!r.first) r.first = today();
      r.touches = r.touches || {};
      r.touches[key] = (r.touches[key] || 0) + 1;
      r.touchTotal = (r.touchTotal || 0) + 1;
      write(d);
    },
    autoTrack: function (id) {
      var SEL = "button, .opt, .flip, .preset, a[href]";
      function all() { return Array.prototype.slice.call(document.querySelectorAll(SEL)); }
      function keyOf(el) {
        if (el.id) return "id:" + el.id;
        var cls = typeof el.className === "string" ? el.className : "";
        return "n:" + el.tagName + "." + cls.slice(0, 20) + ":" + all().indexOf(el);
      }
      // 展开类交互：<details> 追问链 / 发散思考 / 提示折叠
      document.addEventListener("toggle", function (e) {
        var t = e.target;
        if (t && t.tagName === "DETAILS" && t.open) {
          var ds = Array.prototype.slice.call(document.querySelectorAll("details"));
          LM.touch(id, "det:" + ds.indexOf(t) + ":" + (typeof t.className === "string" ? t.className : ""));
        }
      }, true);
      // 点击类交互：按钮 / 测验选项 / 翻卡 / 预设 / 链接
      document.addEventListener("click", function (e) {
        var t = e.target;
        if (!t || typeof t.closest !== "function") return;
        var el = t.closest(SEL);
        if (el && document.body.contains(el)) LM.touch(id, keyOf(el));
      }, true);
    },
    quiz: function (id, score, total) {
      var d = read(), r = d[id] || (d[id] = {});
      if (!r.first) r.first = today();
      r.quiz = Math.max(r.quiz || 0, score);
      r.total = total;
      r.done = true;
      if (!r.doneDate) r.doneDate = today();
      write(d);
    },
    get: function (id) { return read()[id] || null; },
    all: function () { return read(); },
    exportData: function () { return JSON.stringify(read()); },
    importData: function (json) {
      JSON.parse(json); // 校验，失败抛错
      localStorage.setItem(KEY, json);
      return true;
    },
    stats: function () {
      var d = read(), done = 0, visited = 0, dates = {}, first = null, totalTouches = 0, k, r;
      for (k in d) {
        r = d[k];
        if (!r || !r.first) continue;
        if (!first || r.first < first) first = r.first;
        if (r.last) dates[r.last] = 1;
        if (r.touchTotal) totalTouches += r.touchTotal;
        if (r.done) { done++; if (r.doneDate) dates[r.doneDate] = 1; }
        else if (r.visits || r.touchTotal) visited++;
      }
      var ds = Object.keys(dates).sort(), streak = 0, DAY = 86400000;
      if (ds.length) {
        var endDate = new Date(ds[ds.length - 1] + "T00:00:00");
        var nowDate = new Date(today() + "T00:00:00");
        if (Math.floor((nowDate - endDate) / DAY) <= 1) {
          streak = 1;
          for (var i = ds.length - 2; i >= 0; i--) {
            var prev = new Date(ds[i] + "T00:00:00"), last = new Date(ds[i + 1] + "T00:00:00");
            if (Math.round((last - prev) / DAY) === 1) streak++;
            else break;
          }
        }
      }
      var spanDays = first ? Math.floor((new Date(today() + "T00:00:00") - new Date(first + "T00:00:00")) / DAY) + 1 : 0;
      return { done: done, visited: visited, streak: streak, spanDays: spanDays, since: first, totalTouches: totalTouches };
    }
  };
  window.LIANMO = LM;
})();
