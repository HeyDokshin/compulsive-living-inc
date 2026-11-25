// The game in a window of its own: the system web engine (WebKit) and nothing else — no browser, no
// Electron. The game is the same single dist/index.html, kept inside the app. Built by tools/desktop/build.mjs.
import AppKit
import UniformTypeIdentifiers
import WebKit

let scheme = "compulsive"
let start = URL(string: "\(scheme)://game/index.html")!

/// Gives the page its file. A scheme of our own has a steady origin, so saves survive app updates and moves.
final class GameFiles: NSObject, WKURLSchemeHandler {
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url, url.path == "/index.html",
      let file = Bundle.main.url(forResource: "index", withExtension: "html"),
      let data = try? Data(contentsOf: file)
    else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    task.didReceive(
      HTTPURLResponse(
        url: url, statusCode: 200, httpVersion: "HTTP/1.1",
        headerFields: ["Content-Type": "text/html; charset=utf-8", "Content-Length": String(data.count), "Cache-Control": "no-store"])!)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
  private var window: NSWindow!
  private var web: WKWebView!
  /// `--smoke out.png`: run `out.png.js` in the game without touching the saves, take a picture, quit.
  /// With `--keep` the saves are real and leaving goes the usual way (for a copy with another bundle id).
  private let smoke: String? = {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: "--smoke"), i + 1 < args.count else { return nil }
    return args[i + 1]
  }()

  private let keep = CommandLine.arguments.contains("--keep")

  func applicationDidFinishLaunching(_ note: Notification) {
    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(GameFiles(), forURLScheme: scheme)
    config.mediaTypesRequiringUserActionForPlayback = []
    config.preferences.isElementFullscreenEnabled = true
    if smoke != nil && !keep { config.websiteDataStore = .nonPersistent() }

    web = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.allowsMagnification = false
    if #available(macOS 13.3, *) { web.isInspectable = true }

    window = NSWindow(
      contentRect: web.frame, styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Compulsive Living"
    window.minSize = NSSize(width: 640, height: 480)
    window.backgroundColor = NSColor(red: 0.62, green: 0.83, blue: 0.9, alpha: 1)
    window.collectionBehavior = [.fullScreenPrimary]
    window.isReleasedWhenClosed = false
    window.contentView = web
    window.delegate = self
    window.center()
    if smoke == nil { window.setFrameAutosaveName("game") }
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(web)
    NSApp.mainMenu = menu()
    NSApp.activate(ignoringOtherApps: true)
    web.load(URLRequest(url: start))
  }

  // MARK: leaving — the island is saved first

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  private var leaving = false

  func applicationShouldTerminate(_ app: NSApplication) -> NSApplication.TerminateReply {
    if leaving || (smoke != nil && !keep) { return .terminateNow }
    leaving = true
    var answered = false
    let go = {
      if answered { return }
      answered = true
      app.reply(toApplicationShouldTerminate: true)
    }
    web.callAsyncJavaScript(
      "if (globalThis.game && !game.title.visible.value) await game.sessions.save()", arguments: [:], in: nil, in: .page
    ) { _ in go() }
    DispatchQueue.main.asyncAfter(deadline: .now() + 4, execute: go)  // never hang on the way out
    return .terminateLater
  }

  // MARK: links, files

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    let s = action.request.url?.scheme ?? ""
    if s == "http" || s == "https" {
      if action.navigationType == .linkActivated { NSWorkspace.shared.open(action.request.url!) }
      return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
  func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

  func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
    let panel = NSSavePanel()
    panel.nameFieldStringValue = suggestedFilename
    panel.beginSheetModal(for: window) { r in
      guard r == .OK, let url = panel.url else { return completionHandler(nil) }
      try? FileManager.default.removeItem(at: url)  // the panel has asked about replacing it
      completionHandler(url)
    }
  }

  func webView(_ webView: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = p.allowsMultipleSelection
    panel.beginSheetModal(for: window) { r in completionHandler(r == .OK ? panel.urls : nil) }
  }

  /// The web process died (memory, a driver): start again from the last save.
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.load(URLRequest(url: start)) }

  // MARK: menu

  private func menu() -> NSMenu {
    func item(_ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
      i.keyEquivalentModifierMask = mods
      return i
    }
    func sub(_ title: String, _ items: [NSMenuItem]) -> NSMenuItem {
      let m = NSMenu(title: title)
      items.forEach(m.addItem)
      let i = NSMenuItem()
      i.submenu = m
      return i
    }
    let main = NSMenu()
    main.addItem(
      sub("Compulsive Living", [
        item("О программе", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""),
        .separator(),
        item("Скрыть", #selector(NSApplication.hide(_:)), "h"),
        item("Выйти", #selector(NSApplication.terminate(_:)), "q"),
      ]))
    main.addItem(
      sub("Правка", [
        item("Вырезать", #selector(NSText.cut(_:)), "x"),
        item("Копировать", #selector(NSText.copy(_:)), "c"),
        item("Вставить", #selector(NSText.paste(_:)), "v"),
        item("Выбрать всё", #selector(NSText.selectAll(_:)), "a"),
      ]))
    main.addItem(
      sub("Окно", [
        item("На весь экран", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control]),
        item("Свернуть", #selector(NSWindow.performMiniaturize(_:)), "m"),
        item("Закрыть", #selector(NSWindow.performClose(_:)), "w"),
      ]))
    return main
  }

  // MARK: smoke test

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    guard let out = smoke else { return }
    let script = (try? String(contentsOfFile: out + ".js", encoding: .utf8)) ?? "return 'no script'"
    web.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
      switch result {
      case .success(let v): print(v)
      case .failure(let e): print("FAILED \((e as NSError).userInfo)")
      }
      self.web.takeSnapshot(with: nil) { image, _ in
        if let tiff = image?.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff) {
          try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: out))
        }
        if self.keep { NSApp.terminate(nil) } else { exit(0) }
      }
    }
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
