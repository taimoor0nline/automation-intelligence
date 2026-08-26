using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using AITestPilot.Application.Abstractions;
using AITestPilot.Domain.Testing;
using Deque.AxeCore.Playwright;
using Microsoft.Playwright;

namespace AITestPilot.Playwright;

public sealed class PlaywrightExecutionEngine : ITestExecutionEngine
{
    public async Task<TestExecutionResult> ExecuteAsync(TestExecutionRequest request, CancellationToken cancellationToken)
    {
        var runWatch = Stopwatch.StartNew();
        using var playwright = await Microsoft.Playwright.Playwright.CreateAsync();
        var browserType = request.Options.Browser.ToLowerInvariant() switch
        {
            "firefox" => playwright.Firefox,
            "webkit" => playwright.Webkit,
            _ => playwright.Chromium
        };

        await using var browser = await browserType.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = request.Options.Headless,
            SlowMo = Math.Max(0, request.Options.SlowMoMs)
        });

        var results = new List<TestCaseExecutionResult>();
        foreach (var testCase in request.TestCases)
        {
            cancellationToken.ThrowIfCancellationRequested();
            results.Add(await ExecuteCaseAsync(browser, request, testCase, cancellationToken));
        }

        runWatch.Stop();
        return new TestExecutionResult(
            request.TestRunId,
            results.Count,
            results.Count(x => x.Passed),
            results.Count(x => !x.Passed && !x.Skipped),
            results.Count(x => x.Skipped),
            runWatch.Elapsed,
            results);
    }

    private static async Task<TestCaseExecutionResult> ExecuteCaseAsync(
        IBrowser browser,
        TestExecutionRequest request,
        TestExecutionCase testCase,
        CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        var root = request.Options.ArtifactDirectory ?? Path.Combine(AppContext.BaseDirectory, "artifacts");
        var caseDir = Path.Combine(root, request.TestRunId.ToString("N"), testCase.TestCaseNumber);
        Directory.CreateDirectory(caseDir);

        var videoDir = request.Options.CaptureVideo ? Path.Combine(caseDir, "video") : null;
        if (videoDir is not null) Directory.CreateDirectory(videoDir);

        var context = await browser.NewContextAsync(new BrowserNewContextOptions
        {
            BaseURL = request.StartingUrl,
            RecordVideoDir = videoDir
        });

        var tracePath = request.Options.CaptureTrace ? Path.Combine(caseDir, "trace.zip") : null;
        if (tracePath is not null)
        {
            await context.Tracing.StartAsync(new TracingStartOptions { Screenshots = true, Snapshots = true, Sources = true });
        }

        var page = await context.NewPageAsync();
        var browserEvents = new ConcurrentBag<BrowserExecutionEvidence>();
        var networkEvents = new ConcurrentBag<NetworkExecutionEvidence>();
        var requests = new ConcurrentBag<IRequest>();
        var responses = new ConcurrentBag<IResponse>();
        var downloads = new ConcurrentBag<IDownload>();
        var requestStarted = new ConcurrentDictionary<IRequest, DateTimeOffset>();
        var initialPageCount = context.Pages.Count;

        page.Console += (_, message) => browserEvents.Add(new BrowserExecutionEvidence(DateTimeOffset.UtcNow, "Console", message.Type, message.Text, page.Url));
        page.PageError += (_, error) => browserEvents.Add(new BrowserExecutionEvidence(DateTimeOffset.UtcNow, "PageError", "error", error, page.Url));
        page.Download += (_, download) => downloads.Add(download);
        context.Page += (_, popup) => browserEvents.Add(new BrowserExecutionEvidence(DateTimeOffset.UtcNow, "Popup", null, "New page opened", popup.Url));
        page.Request += (_, req) =>
        {
            requests.Add(req);
            requestStarted[req] = DateTimeOffset.UtcNow;
        };
        page.Response += (_, response) =>
        {
            responses.Add(response);
            var now = DateTimeOffset.UtcNow;
            var started = requestStarted.TryGetValue(response.Request, out var at) ? at : now;
            networkEvents.Add(new NetworkExecutionEvidence(now, response.Url, response.Request.Method, response.Status, response.Request.ResourceType, false, null, (long)(now - started).TotalMilliseconds));
        };
        page.RequestFailed += (_, req) =>
        {
            var now = DateTimeOffset.UtcNow;
            var started = requestStarted.TryGetValue(req, out var at) ? at : now;
            networkEvents.Add(new NetworkExecutionEvidence(now, req.Url, req.Method, null, req.ResourceType, true, req.Failure, (long)(now - started).TotalMilliseconds));
        };

        var assertionResults = new List<AssertionExecutionEvidence>();
        string? screenshotPath = null;
        string? videoPath = null;
        string? failureType = null;
        string? failureMessage = null;
        var passed = true;

        try
        {
            foreach (var step in testCase.Definition.Steps.OrderBy(x => x.Sequence))
            {
                cancellationToken.ThrowIfCancellationRequested();
                await ExecuteStepAsync(page, request.StartingUrl, step, cancellationToken);
            }

            foreach (var assertion in testCase.Definition.Assertions.OrderBy(x => x.Sequence))
            {
                var started = DateTimeOffset.UtcNow;
                try
                {
                    var actual = await ExecuteAssertionAsync(page, context, assertion, requests, responses, downloads, networkEvents, browserEvents, initialPageCount, cancellationToken);
                    assertionResults.Add(new AssertionExecutionEvidence(assertion.Sequence, assertion.Type, true, assertion.Expected, actual, null, started, DateTimeOffset.UtcNow));
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    passed = false;
                    assertionResults.Add(new AssertionExecutionEvidence(assertion.Sequence, assertion.Type, false, assertion.Expected, null, ex.Message, started, DateTimeOffset.UtcNow));
                }
            }

            if (!passed)
            {
                failureType = "Assertion";
                failureMessage = assertionResults.FirstOrDefault(x => !x.Passed)?.FailureMessage;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            passed = false;
            failureType = "Execution";
            failureMessage = ex.Message;
        }
        finally
        {
            if (!passed && request.Options.CaptureScreenshotOnFailure)
            {
                screenshotPath = Path.Combine(caseDir, "failure.png");
                try { await page.ScreenshotAsync(new PageScreenshotOptions { Path = screenshotPath, FullPage = true }); } catch { screenshotPath = null; }
            }

            if (tracePath is not null)
            {
                try { await context.Tracing.StopAsync(new TracingStopOptions { Path = tracePath }); } catch { tracePath = null; }
            }

            if (page.Video is not null)
            {
                try { videoPath = await page.Video.PathAsync(); } catch { videoPath = null; }
            }

            await context.CloseAsync();
        }

        watch.Stop();
        return new TestCaseExecutionResult(
            testCase.TestCaseId,
            testCase.TestCaseNumber,
            passed,
            false,
            watch.Elapsed,
            failureType,
            failureMessage,
            assertionResults,
            browserEvents.OrderBy(x => x.OccurredAtUtc).ToArray(),
            networkEvents.OrderBy(x => x.OccurredAtUtc).ToArray(),
            screenshotPath,
            videoPath,
            tracePath);
    }

    private static async Task ExecuteStepAsync(IPage page, string startingUrl, TestStepDefinition step, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var locator = step.Locator is null ? null : ResolveLocator(page, step.Locator);
        switch (step.Action)
        {
            case TestAction.Navigate:
                var destination = string.IsNullOrWhiteSpace(step.Target) ? startingUrl : new Uri(new Uri(startingUrl), step.Target).ToString();
                await page.GotoAsync(destination, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded });
                break;
            case TestAction.Click: await Required(locator).ClickAsync(); break;
            case TestAction.Fill: await Required(locator).FillAsync(step.Value ?? string.Empty); break;
            case TestAction.Clear: await Required(locator).ClearAsync(); break;
            case TestAction.Check: await Required(locator).CheckAsync(); break;
            case TestAction.Uncheck: await Required(locator).UncheckAsync(); break;
            case TestAction.SelectOption: await Required(locator).SelectOptionAsync(step.Value ?? string.Empty); break;
            case TestAction.Press: await Required(locator).PressAsync(step.Value ?? "Enter"); break;
            case TestAction.Hover: await Required(locator).HoverAsync(); break;
            case TestAction.Focus: await Required(locator).FocusAsync(); break;
            case TestAction.UploadFile: await Required(locator).SetInputFilesAsync(step.Value ?? throw new InvalidOperationException("Upload path is required.")); break;
            case TestAction.Wait: await Task.Delay(int.TryParse(step.Value, out var ms) ? Math.Clamp(ms, 0, 30000) : 500, cancellationToken); break;
            case TestAction.Reload: await page.ReloadAsync(); break;
            case TestAction.GoBack: await page.GoBackAsync(); break;
            case TestAction.GoForward: await page.GoForwardAsync(); break;
            default: throw new NotSupportedException($"Unsupported action {step.Action}.");
        }
    }

    private static async Task<string?> ExecuteAssertionAsync(
        IPage page,
        IBrowserContext context,
        AssertionDefinition a,
        IEnumerable<IRequest> requests,
        IEnumerable<IResponse> responses,
        IEnumerable<IDownload> downloads,
        IEnumerable<NetworkExecutionEvidence> networkEvents,
        IEnumerable<BrowserExecutionEvidence> browserEvents,
        int initialPageCount,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var locator = a.Locator is null ? null : ResolveLocator(page, a.Locator);
        var expected = a.Expected ?? string.Empty;
        var expectedNumber = a.ExpectedNumber ?? ParseInt(expected);

        switch (a.Type)
        {
            case AssertionType.ElementExists: return Pass(await EventuallyAsync(async () => await Required(locator).CountAsync() > 0));
            case AssertionType.ElementNotExists: return Pass(await EventuallyAsync(async () => await Required(locator).CountAsync() == 0));
            case AssertionType.ElementVisible: return Pass(await EventuallyAsync(() => Required(locator).IsVisibleAsync()));
            case AssertionType.ElementHidden: return Pass(await EventuallyAsync(async () => await Required(locator).CountAsync() > 0 && !await Required(locator).IsVisibleAsync()));
            case AssertionType.ElementHiddenOrAbsent: return Pass(await EventuallyAsync(async () => await Required(locator).CountAsync() == 0 || !await Required(locator).IsVisibleAsync()));

            case AssertionType.TextEquals: return Check(await Required(locator).InnerTextAsync(), x => x == expected, expected);
            case AssertionType.TextContains: return Check(await Required(locator).InnerTextAsync(), x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.TextNotContains: return Check(await Required(locator).InnerTextAsync(), x => !x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.TextEmpty: return Check(await Required(locator).InnerTextAsync(), string.IsNullOrEmpty, "empty");
            case AssertionType.TextNonEmpty: return Check(await Required(locator).InnerTextAsync(), x => !string.IsNullOrEmpty(x), "non-empty");
            case AssertionType.HtmlEquals: return Check(await Required(locator).InnerHTMLAsync(), x => x == expected, expected);
            case AssertionType.HtmlContains: return Check(await Required(locator).InnerHTMLAsync(), x => x.Contains(expected, StringComparison.Ordinal), expected);

            case AssertionType.ValueEquals:
            case AssertionType.SelectedValueEquals: return Check(await Required(locator).InputValueAsync(), x => x == expected, expected);
            case AssertionType.ValueContains: return Check(await Required(locator).InputValueAsync(), x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.ValueEmpty: return Check(await Required(locator).InputValueAsync(), string.IsNullOrEmpty, "empty");
            case AssertionType.ValueNonEmpty: return Check(await Required(locator).InputValueAsync(), x => !string.IsNullOrEmpty(x), "non-empty");
            case AssertionType.ValueLengthEquals: return NumberCheck((await Required(locator).InputValueAsync()).Length, x => x == expectedNumber, expectedNumber);
            case AssertionType.ValueLengthLessThanOrEqual: return NumberCheck((await Required(locator).InputValueAsync()).Length, x => x <= expectedNumber, expectedNumber);
            case AssertionType.ValueLengthGreaterThanOrEqual: return NumberCheck((await Required(locator).InputValueAsync()).Length, x => x >= expectedNumber, expectedNumber);
            case AssertionType.Checked: return Pass(await Required(locator).IsCheckedAsync());
            case AssertionType.Unchecked: return Pass(!await Required(locator).IsCheckedAsync());
            case AssertionType.Enabled: return Pass(await Required(locator).IsEnabledAsync());
            case AssertionType.Disabled: return Pass(await Required(locator).IsDisabledAsync());
            case AssertionType.Focused: return Pass(await Required(locator).EvaluateAsync<bool>("el => document.activeElement === el"));
            case AssertionType.Required: return Pass(await Required(locator).GetAttributeAsync("required") is not null);
            case AssertionType.Optional: return Pass(await Required(locator).GetAttributeAsync("required") is null);
            case AssertionType.Html5Valid: return Pass(await Required(locator).EvaluateAsync<bool>("el => typeof el.checkValidity === 'function' && el.checkValidity()"));
            case AssertionType.Html5Invalid: return Pass(await Required(locator).EvaluateAsync<bool>("el => typeof el.checkValidity === 'function' && !el.checkValidity()"));

            case AssertionType.AttributeExists: return Pass(await Required(locator).GetAttributeAsync(RequiredName(a)) is not null);
            case AssertionType.AttributeAbsent: return Pass(await Required(locator).GetAttributeAsync(RequiredName(a)) is null);
            case AssertionType.AttributeEquals: return Check(await Required(locator).GetAttributeAsync(RequiredName(a)) ?? string.Empty, x => x == expected, expected);
            case AssertionType.AttributeContains: return Check(await Required(locator).GetAttributeAsync(RequiredName(a)) ?? string.Empty, x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.PropertyEquals: return Check(await Required(locator).EvaluateAsync<string?>("(el, name) => String(el[name])", RequiredName(a)) ?? string.Empty, x => x == expected, expected);
            case AssertionType.ClassPresent: return Check(await Required(locator).GetAttributeAsync("class") ?? string.Empty, x => x.Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains(expected), expected);
            case AssertionType.ClassAbsent: return Check(await Required(locator).GetAttributeAsync("class") ?? string.Empty, x => !x.Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains(expected), expected);
            case AssertionType.CssValueEquals: return Check(await Required(locator).EvaluateAsync<string>("(el, name) => getComputedStyle(el).getPropertyValue(name)", RequiredName(a)), x => x.Trim() == expected, expected);
            case AssertionType.PlaceholderEquals: return Check(await Required(locator).GetAttributeAsync("placeholder") ?? string.Empty, x => x == expected, expected);
            case AssertionType.AriaValueEquals: return Check(await Required(locator).GetAttributeAsync(RequiredName(a)) ?? string.Empty, x => x == expected, expected);
            case AssertionType.AccessibleNameEquals: return Check(await Required(locator).EvaluateAsync<string>("el => el.getAttribute('aria-label') || el.innerText || el.value || ''"), x => x.Trim() == expected, expected);
            case AssertionType.AccessibleDescriptionEquals: return Check(await Required(locator).GetAttributeAsync("aria-description") ?? string.Empty, x => x == expected, expected);

            case AssertionType.CountEquals: return NumberCheck(await Required(locator).CountAsync(), x => x == expectedNumber, expectedNumber);
            case AssertionType.CountMinimum: return NumberCheck(await Required(locator).CountAsync(), x => x >= expectedNumber, expectedNumber);
            case AssertionType.CountMaximum: return NumberCheck(await Required(locator).CountAsync(), x => x <= expectedNumber, expectedNumber);

            case AssertionType.UrlEquals: return Check(page.Url, x => x == expected, expected);
            case AssertionType.UrlIncludes: return Check(page.Url, x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.UrlNotIncludes: return Check(page.Url, x => !x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.PathEquals: return Check(new Uri(page.Url).AbsolutePath, x => x == expected, expected);
            case AssertionType.PathIncludes: return Check(new Uri(page.Url).AbsolutePath, x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.QueryStringEquals: return Check(new Uri(page.Url).Query, x => x.TrimStart('?') == expected.TrimStart('?'), expected);
            case AssertionType.QueryStringIncludes: return Check(new Uri(page.Url).Query, x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.HashEquals: return Check(new Uri(page.Url).Fragment, x => x.TrimStart('#') == expected.TrimStart('#'), expected);
            case AssertionType.TitleEquals: return Check(await page.TitleAsync(), x => x == expected, expected);
            case AssertionType.TitleIncludes: return Check(await page.TitleAsync(), x => x.Contains(expected, StringComparison.Ordinal), expected);

            case AssertionType.CookieExists:
            case AssertionType.CookieEquals:
            case AssertionType.CookieAbsent:
            {
                var cookie = (await context.CookiesAsync()).FirstOrDefault(x => x.Name == RequiredName(a));
                if (a.Type == AssertionType.CookieExists) return Pass(cookie is not null);
                if (a.Type == AssertionType.CookieAbsent) return Pass(cookie is null);
                return Check(cookie?.Value ?? string.Empty, x => x == expected, expected);
            }
            case AssertionType.LocalStorageExists: return Pass(await StorageAsync(page, "localStorage", RequiredName(a)) is not null);
            case AssertionType.LocalStorageAbsent: return Pass(await StorageAsync(page, "localStorage", RequiredName(a)) is null);
            case AssertionType.LocalStorageEquals: return Check(await StorageAsync(page, "localStorage", RequiredName(a)) ?? string.Empty, x => x == expected, expected);
            case AssertionType.SessionStorageExists: return Pass(await StorageAsync(page, "sessionStorage", RequiredName(a)) is not null);
            case AssertionType.SessionStorageAbsent: return Pass(await StorageAsync(page, "sessionStorage", RequiredName(a)) is null);
            case AssertionType.SessionStorageEquals: return Check(await StorageAsync(page, "sessionStorage", RequiredName(a)) ?? string.Empty, x => x == expected, expected);

            case AssertionType.RequestOccurred: return Pass(FindRequests(requests, a).Any());
            case AssertionType.RequestNotOccurred: return Pass(!FindRequests(requests, a).Any());
            case AssertionType.RequestCountEquals: return NumberCheck(FindRequests(requests, a).Count(), x => x == expectedNumber, expectedNumber);
            case AssertionType.RequestMethodEquals: return Check(FindRequests(requests, a).LastOrDefault()?.Method ?? string.Empty, x => x == expected, expected);
            case AssertionType.RequestHeaderEquals:
            {
                var req = FindRequests(requests, a).LastOrDefault() ?? throw new InvalidOperationException("Matching request not found.");
                return Check(req.Headers.TryGetValue(RequiredName(a), out var value) ? value : string.Empty, x => x == expected, expected);
            }
            case AssertionType.RequestBodyEquals: return Check(FindRequests(requests, a).LastOrDefault()?.PostData ?? string.Empty, x => x == expected, expected);
            case AssertionType.RequestBodyContains: return Check(FindRequests(requests, a).LastOrDefault()?.PostData ?? string.Empty, x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.RequestJsonPathEquals: return Check(JsonPath(FindRequests(requests, a).LastOrDefault()?.PostData, RequiredName(a)), x => x == expected, expected);
            case AssertionType.RequestDurationAtMost:
            {
                var durations = networkEvents.Where(x => TargetMatch(x.Url, a.Target)).Select(x => x.DurationMs ?? 0).ToArray();
                if (durations.Length == 0) throw new InvalidOperationException("Matching network request not found.");
                return NumberCheck((int)durations.Max(), x => x <= expectedNumber, expectedNumber);
            }
            case AssertionType.ResponseStatusEquals:
            {
                var response = FindResponses(responses, a).LastOrDefault() ?? throw new InvalidOperationException("Matching response not found.");
                return NumberCheck(response.Status, x => x == expectedNumber, expectedNumber);
            }
            case AssertionType.ResponseStatusInRange:
            {
                var response = FindResponses(responses, a).LastOrDefault() ?? throw new InvalidOperationException("Matching response not found.");
                var min = a.Options is not null && a.Options.TryGetValue("min", out var minText) ? ParseInt(minText) : 200;
                var max = a.Options is not null && a.Options.TryGetValue("max", out var maxText) ? ParseInt(maxText) : 299;
                return Pass(response.Status >= min && response.Status <= max, response.Status.ToString());
            }
            case AssertionType.ResponseHeaderExists:
            case AssertionType.ResponseHeaderEquals:
            {
                var response = FindResponses(responses, a).LastOrDefault() ?? throw new InvalidOperationException("Matching response not found.");
                var has = response.Headers.TryGetValue(RequiredName(a), out var value);
                return a.Type == AssertionType.ResponseHeaderExists ? Pass(has) : Check(has ? value : string.Empty, x => x == expected, expected);
            }
            case AssertionType.ResponseBodyEquals:
            case AssertionType.ResponseBodyContains:
            case AssertionType.ResponseJsonPathEquals:
            {
                var response = FindResponses(responses, a).LastOrDefault() ?? throw new InvalidOperationException("Matching response not found.");
                var body = await response.TextAsync();
                if (a.Type == AssertionType.ResponseBodyEquals) return Check(body, x => x == expected, expected);
                if (a.Type == AssertionType.ResponseBodyContains) return Check(body, x => x.Contains(expected, StringComparison.Ordinal), expected);
                return Check(JsonPath(body, RequiredName(a)), x => x == expected, expected);
            }

            case AssertionType.NoAccessibilityViolations:
            case AssertionType.NoCriticalAccessibilityViolations:
            case AssertionType.MaximumAccessibilityViolations:
            {
                var axe = await page.RunAxe();
                var violations = axe.Violations?.ToArray() ?? [];
                if (a.Type == AssertionType.NoAccessibilityViolations) return NumberCheck(violations.Length, x => x == 0, 0);
                if (a.Type == AssertionType.NoCriticalAccessibilityViolations)
                    return NumberCheck(violations.Count(x => string.Equals(x.Impact, "critical", StringComparison.OrdinalIgnoreCase)), x => x == 0, 0);
                return NumberCheck(violations.Length, x => x <= expectedNumber, expectedNumber);
            }

            case AssertionType.FileDownloaded: return Pass(downloads.Any());
            case AssertionType.FileNotDownloaded: return Pass(!downloads.Any());
            case AssertionType.FileNameEquals: return Check(downloads.LastOrDefault()?.SuggestedFilename ?? string.Empty, x => x == expected, expected);
            case AssertionType.FileNameContains: return Check(downloads.LastOrDefault()?.SuggestedFilename ?? string.Empty, x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.FileExists:
            case AssertionType.FileSizeEquals:
            case AssertionType.FileSizeMinimum:
            case AssertionType.FileSizeMaximum:
            case AssertionType.FileContentEquals:
            case AssertionType.FileContentContains:
            case AssertionType.JsonFilePathEquals:
            {
                var download = downloads.LastOrDefault() ?? throw new InvalidOperationException("No downloaded file is available.");
                var path = await download.PathAsync();
                if (a.Type == AssertionType.FileExists) return Pass(File.Exists(path));
                var info = new FileInfo(path);
                if (a.Type == AssertionType.FileSizeEquals) return NumberCheck((int)info.Length, x => x == expectedNumber, expectedNumber);
                if (a.Type == AssertionType.FileSizeMinimum) return NumberCheck((int)info.Length, x => x >= expectedNumber, expectedNumber);
                if (a.Type == AssertionType.FileSizeMaximum) return NumberCheck((int)info.Length, x => x <= expectedNumber, expectedNumber);
                var contents = await File.ReadAllTextAsync(path, cancellationToken);
                if (a.Type == AssertionType.FileContentEquals) return Check(contents, x => x == expected, expected);
                if (a.Type == AssertionType.FileContentContains) return Check(contents, x => x.Contains(expected, StringComparison.Ordinal), expected);
                return Check(JsonPath(contents, RequiredName(a)), x => x == expected, expected);
            }

            case AssertionType.PageLoadAtMost: return MetricCheck(await PerfAsync(page, "load"), a);
            case AssertionType.DomContentLoadedAtMost: return MetricCheck(await PerfAsync(page, "dom"), a);
            case AssertionType.FirstByteAtMost: return MetricCheck(await PerfAsync(page, "ttfb"), a);
            case AssertionType.TotalTransferSizeAtMost: return MetricCheck(await PerfAsync(page, "transfer"), a);
            case AssertionType.ResourceLoadAtMost:
            case AssertionType.ApiResponseAtMost:
            {
                var matching = networkEvents.Where(x => TargetMatch(x.Url, a.Target)).Select(x => (double)(x.DurationMs ?? 0)).ToArray();
                if (matching.Length == 0) throw new InvalidOperationException("Matching resource/API request not found.");
                return MetricCheck(matching.Max(), a);
            }
            case AssertionType.WebVitalAtMost: return MetricCheck(await WebVitalAsync(page, RequiredName(a)), a);

            case AssertionType.NewWindowOpened: return Pass(context.Pages.Count > initialPageCount);
            case AssertionType.NewWindowNotOpened: return Pass(context.Pages.Count == initialPageCount);
            case AssertionType.NewWindowCountEquals: return NumberCheck(context.Pages.Count - initialPageCount, x => x == expectedNumber, expectedNumber);
            case AssertionType.NewWindowUrlEquals: return Check(context.Pages.LastOrDefault()?.Url ?? string.Empty, x => x == expected, expected);
            case AssertionType.NewWindowUrlContains: return Check(context.Pages.LastOrDefault()?.Url ?? string.Empty, x => x.Contains(expected, StringComparison.Ordinal), expected);
            case AssertionType.NewWindowTitleEquals:
            {
                var popup = context.Pages.LastOrDefault() ?? throw new InvalidOperationException("No page is available.");
                return Check(await popup.TitleAsync(), x => x == expected, expected);
            }

            case AssertionType.NoConsoleErrors: return NumberCheck(browserEvents.Count(x => x.Type == "Console" && string.Equals(x.Level, "error", StringComparison.OrdinalIgnoreCase)), x => x == 0, 0);
            case AssertionType.MaximumConsoleWarnings: return NumberCheck(browserEvents.Count(x => x.Type == "Console" && string.Equals(x.Level, "warning", StringComparison.OrdinalIgnoreCase)), x => x <= expectedNumber, expectedNumber);
            case AssertionType.NoPageErrors: return NumberCheck(browserEvents.Count(x => x.Type == "PageError"), x => x == 0, 0);
            case AssertionType.NoFailedRequests: return NumberCheck(networkEvents.Count(x => x.Failed), x => x == 0, 0);
            case AssertionType.NoHttp500Responses: return NumberCheck(networkEvents.Count(x => x.ResponseStatus is >= 500 and <= 599), x => x == 0, 0);
            default: throw new NotSupportedException($"Assertion {a.Type} has not been implemented by the Playwright engine.");
        }
    }

    private static ILocator ResolveLocator(IPage page, LocatorDefinition locator) => locator.Strategy switch
    {
        LocatorStrategy.TestId => page.GetByTestId(locator.Value),
        LocatorStrategy.Label => page.GetByLabel(locator.Value, new PageGetByLabelOptions { Exact = locator.Exact }),
        LocatorStrategy.Placeholder => page.GetByPlaceholder(locator.Value, new PageGetByPlaceholderOptions { Exact = locator.Exact }),
        LocatorStrategy.Text => page.GetByText(locator.Value, new PageGetByTextOptions { Exact = locator.Exact }),
        LocatorStrategy.Role => page.GetByRole(ParseRole(locator.Role ?? locator.Value), new PageGetByRoleOptions { Name = locator.Role is null ? null : locator.Value, Exact = locator.Exact }),
        LocatorStrategy.Id => page.Locator($"#{CssEscape(locator.Value)}"),
        LocatorStrategy.Name => page.Locator($"[name=\"{AttributeEscape(locator.Value)}\"]"),
        LocatorStrategy.AriaLabel => page.Locator($"[aria-label=\"{AttributeEscape(locator.Value)}\"]"),
        LocatorStrategy.XPath => page.Locator($"xpath={locator.Value}"),
        _ => page.Locator(locator.Value)
    };

    private static AriaRole ParseRole(string role) => Enum.TryParse<AriaRole>(role, true, out var parsed) ? parsed : throw new ArgumentException($"Unknown ARIA role '{role}'.");
    private static ILocator Required(ILocator? locator) => locator ?? throw new InvalidOperationException("This operation requires a locator.");
    private static string RequiredName(AssertionDefinition assertion) => !string.IsNullOrWhiteSpace(assertion.Name) ? assertion.Name : throw new InvalidOperationException("Assertion name is required.");
    private static int ParseInt(string value) => int.TryParse(value, out var parsed) ? parsed : 0;
    private static string Pass(bool passed, string actual = "true") { if (!passed) throw new InvalidOperationException("Assertion condition was not satisfied."); return actual; }
    private static string Check(string actual, Func<string, bool> predicate, string expected) { if (!predicate(actual)) throw new InvalidOperationException($"Expected '{expected}' but observed '{actual}'."); return actual; }
    private static string NumberCheck(int actual, Func<int, bool> predicate, int expected) { if (!predicate(actual)) throw new InvalidOperationException($"Expected numeric condition '{expected}' but observed '{actual}'."); return actual.ToString(); }
    private static string MetricCheck(double actual, AssertionDefinition a) { var limit = a.ExpectedMetric ?? a.ExpectedNumber ?? double.TryParse(a.Expected, out var d) ? d : 0; if (actual > limit) throw new InvalidOperationException($"Expected metric <= {limit} but observed {actual:0.##}."); return actual.ToString("0.##"); }
    private static bool TargetMatch(string url, string? target) => string.IsNullOrWhiteSpace(target) || url.Contains(target, StringComparison.OrdinalIgnoreCase);
    private static IEnumerable<IRequest> FindRequests(IEnumerable<IRequest> requests, AssertionDefinition a) => requests.Where(x => TargetMatch(x.Url, a.Target));
    private static IEnumerable<IResponse> FindResponses(IEnumerable<IResponse> responses, AssertionDefinition a) => responses.Where(x => TargetMatch(x.Url, a.Target));
    private static string CssEscape(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal);
    private static string AttributeEscape(string value) => value.Replace("\\", "\\\\", StringComparison.Ordinal).Replace("\"", "\\\"", StringComparison.Ordinal);

    private static async Task<bool> EventuallyAsync(Func<Task<bool>> probe, int timeoutMs = 5000)
    {
        var watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            try { if (await probe()) return true; } catch { }
            await Task.Delay(100);
        }
        return false;
    }

    private static Task<string?> StorageAsync(IPage page, string storage, string key) =>
        page.EvaluateAsync<string?>("([storage,key]) => window[storage].getItem(key)", new[] { storage, key });

    private static string JsonPath(string? json, string path)
    {
        if (string.IsNullOrWhiteSpace(json)) return string.Empty;
        using var document = JsonDocument.Parse(json);
        var current = document.RootElement;
        foreach (var part in path.Trim().TrimStart('$').TrimStart('.').Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            if (current.ValueKind == JsonValueKind.Object && current.TryGetProperty(part, out var next)) current = next;
            else return string.Empty;
        }
        return current.ValueKind == JsonValueKind.String ? current.GetString() ?? string.Empty : current.ToString();
    }

    private static Task<double> PerfAsync(IPage page, string metric) => page.EvaluateAsync<double>("metric => { const n=performance.getEntriesByType('navigation')[0]; if(!n) return 0; if(metric==='load') return n.loadEventEnd-n.startTime; if(metric==='dom') return n.domContentLoadedEventEnd-n.startTime; if(metric==='ttfb') return n.responseStart-n.requestStart; if(metric==='transfer') return n.transferSize||0; return 0; }", metric);

    private static Task<double> WebVitalAsync(IPage page, string metric) => page.EvaluateAsync<double>("metric => { metric=String(metric).toUpperCase(); const n=performance.getEntriesByType('navigation')[0]; if(metric==='TTFB') return n ? n.responseStart-n.requestStart : 0; if(metric==='FCP') { const e=performance.getEntriesByName('first-contentful-paint').at(-1); return e?e.startTime:0; } if(metric==='LCP') { const e=performance.getEntriesByType('largest-contentful-paint').at(-1); return e?e.startTime:0; } if(metric==='CLS') return performance.getEntriesByType('layout-shift').filter(x=>!x.hadRecentInput).reduce((s,x)=>s+x.value,0); return 0; }", metric);
}
