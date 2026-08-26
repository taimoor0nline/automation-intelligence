using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using AITestPilot.Domain.Testing;
using Deque.AxeCore.Playwright;
using Microsoft.Playwright;

namespace AITestPilot.Playwright;

internal static class PlaywrightAssertionExecutor
{
    private const int DefaultRetryTimeoutMs = 5_000;

    public static async Task<string?> ExecuteAsync(
        IPage page,
        IBrowserContext context,
        AssertionDefinition assertion,
        PlaywrightObservation observation,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var locator = assertion.Locator is null ? null : PlaywrightLocatorResolver.Resolve(page, assertion.Locator);
        var expected = assertion.Expected ?? string.Empty;
        var expectedNumber = assertion.ExpectedNumber ?? ParseInt(expected);

        switch (assertion.Type)
        {
            case AssertionType.ElementExists:
                return Bool(await EventuallyAsync(async () => await Required(locator).CountAsync() > 0), "element exists");
            case AssertionType.ElementNotExists:
                return Bool(await EventuallyAsync(async () => await Required(locator).CountAsync() == 0), "element absent");
            case AssertionType.ElementVisible:
                return Bool(await EventuallyAsync(() => Required(locator).IsVisibleAsync()), "visible");
            case AssertionType.ElementHidden:
                return Bool(await EventuallyAsync(async () => await Required(locator).CountAsync() > 0 && !await Required(locator).IsVisibleAsync()), "hidden");
            case AssertionType.ElementHiddenOrAbsent:
                return Bool(await EventuallyAsync(async () => await Required(locator).CountAsync() == 0 || !await Required(locator).IsVisibleAsync()), "hidden-or-absent");

            case AssertionType.TextEquals:
                return await EventuallyStringAsync(() => Required(locator).InnerTextAsync(), value => value == expected, expected);
            case AssertionType.TextContains:
                return await EventuallyStringAsync(() => Required(locator).InnerTextAsync(), value => value.Contains(expected, StringComparison.Ordinal), $"contains '{expected}'");
            case AssertionType.TextNotContains:
                return await EventuallyStringAsync(() => Required(locator).InnerTextAsync(), value => !value.Contains(expected, StringComparison.Ordinal), $"does not contain '{expected}'");
            case AssertionType.TextEmpty:
                return await EventuallyStringAsync(() => Required(locator).InnerTextAsync(), string.IsNullOrEmpty, "empty");
            case AssertionType.TextNonEmpty:
                return await EventuallyStringAsync(() => Required(locator).InnerTextAsync(), value => !string.IsNullOrEmpty(value), "non-empty");
            case AssertionType.HtmlEquals:
                return await EventuallyStringAsync(() => Required(locator).InnerHTMLAsync(), value => value == expected, expected);
            case AssertionType.HtmlContains:
                return await EventuallyStringAsync(() => Required(locator).InnerHTMLAsync(), value => value.Contains(expected, StringComparison.Ordinal), $"HTML contains '{expected}'");

            case AssertionType.ValueEquals:
            case AssertionType.SelectedValueEquals:
                return await EventuallyStringAsync(() => Required(locator).InputValueAsync(), value => value == expected, expected);
            case AssertionType.ValueContains:
                return await EventuallyStringAsync(() => Required(locator).InputValueAsync(), value => value.Contains(expected, StringComparison.Ordinal), $"value contains '{expected}'");
            case AssertionType.ValueEmpty:
                return await EventuallyStringAsync(() => Required(locator).InputValueAsync(), string.IsNullOrEmpty, "empty value");
            case AssertionType.ValueNonEmpty:
                return await EventuallyStringAsync(() => Required(locator).InputValueAsync(), value => !string.IsNullOrEmpty(value), "non-empty value");
            case AssertionType.ValueLengthEquals:
                return Number((await Required(locator).InputValueAsync()).Length, value => value == expectedNumber, expectedNumber);
            case AssertionType.ValueLengthLessThanOrEqual:
                return Number((await Required(locator).InputValueAsync()).Length, value => value <= expectedNumber, expectedNumber);
            case AssertionType.ValueLengthGreaterThanOrEqual:
                return Number((await Required(locator).InputValueAsync()).Length, value => value >= expectedNumber, expectedNumber);
            case AssertionType.Checked:
                return Bool(await EventuallyAsync(() => Required(locator).IsCheckedAsync()), "checked");
            case AssertionType.Unchecked:
                return Bool(await EventuallyAsync(async () => !await Required(locator).IsCheckedAsync()), "unchecked");
            case AssertionType.Enabled:
                return Bool(await EventuallyAsync(() => Required(locator).IsEnabledAsync()), "enabled");
            case AssertionType.Disabled:
                return Bool(await EventuallyAsync(() => Required(locator).IsDisabledAsync()), "disabled");
            case AssertionType.Focused:
                return Bool(await EventuallyAsync(() => Required(locator).EvaluateAsync<bool>("el => document.activeElement === el")), "focused");
            case AssertionType.Required:
                return Bool(await Required(locator).GetAttributeAsync("required") is not null, "required");
            case AssertionType.Optional:
                return Bool(await Required(locator).GetAttributeAsync("required") is null, "optional");
            case AssertionType.Html5Valid:
                return Bool(await Required(locator).EvaluateAsync<bool>("el => typeof el.checkValidity === 'function' && el.checkValidity()"), "HTML5 valid");
            case AssertionType.Html5Invalid:
                return Bool(await Required(locator).EvaluateAsync<bool>("el => typeof el.checkValidity === 'function' && !el.checkValidity()"), "HTML5 invalid");

            case AssertionType.AttributeExists:
                return Bool(await Required(locator).GetAttributeAsync(RequiredName(assertion)) is not null, "attribute exists");
            case AssertionType.AttributeAbsent:
                return Bool(await Required(locator).GetAttributeAsync(RequiredName(assertion)) is null, "attribute absent");
            case AssertionType.AttributeEquals:
                return await EventuallyNullableStringAsync(() => Required(locator).GetAttributeAsync(RequiredName(assertion)), value => value == expected, expected);
            case AssertionType.AttributeContains:
                return await EventuallyNullableStringAsync(() => Required(locator).GetAttributeAsync(RequiredName(assertion)), value => value?.Contains(expected, StringComparison.Ordinal) == true, $"contains '{expected}'");
            case AssertionType.PropertyEquals:
                return await EventuallyNullableStringAsync(
                    () => Required(locator).EvaluateAsync<string?>("(el, name) => String(el[name])", RequiredName(assertion)),
                    value => value == expected,
                    expected);
            case AssertionType.ClassPresent:
                return await EventuallyNullableStringAsync(
                    () => Required(locator).GetAttributeAsync("class"),
                    value => TokenContains(value, expected),
                    $"class '{expected}' present");
            case AssertionType.ClassAbsent:
                return await EventuallyNullableStringAsync(
                    () => Required(locator).GetAttributeAsync("class"),
                    value => !TokenContains(value, expected),
                    $"class '{expected}' absent");
            case AssertionType.CssValueEquals:
                return await EventuallyStringAsync(
                    () => Required(locator).EvaluateAsync<string>("(el, name) => getComputedStyle(el).getPropertyValue(name)", RequiredName(assertion)),
                    value => value.Trim() == expected,
                    expected);
            case AssertionType.PlaceholderEquals:
                return await EventuallyNullableStringAsync(() => Required(locator).GetAttributeAsync("placeholder"), value => value == expected, expected);
            case AssertionType.AriaValueEquals:
                return await EventuallyNullableStringAsync(() => Required(locator).GetAttributeAsync(RequiredName(assertion)), value => value == expected, expected);
            case AssertionType.AccessibleNameEquals:
                return await EventuallyStringAsync(
                    () => Required(locator).EvaluateAsync<string>("el => el.getAttribute('aria-label') || el.innerText || el.value || ''"),
                    value => value.Trim() == expected,
                    expected);
            case AssertionType.AccessibleDescriptionEquals:
                return await EventuallyNullableStringAsync(
                    () => Required(locator).GetAttributeAsync("aria-description"),
                    value => value == expected,
                    expected);

            case AssertionType.CountEquals:
                return await EventuallyCountAsync(Required(locator), value => value == expectedNumber, expectedNumber);
            case AssertionType.CountMinimum:
                return await EventuallyCountAsync(Required(locator), value => value >= expectedNumber, expectedNumber);
            case AssertionType.CountMaximum:
                return await EventuallyCountAsync(Required(locator), value => value <= expectedNumber, expectedNumber);

            case AssertionType.UrlEquals:
                return await EventuallyStringAsync(() => Task.FromResult(page.Url), value => value == expected, expected);
            case AssertionType.UrlIncludes:
                return await EventuallyStringAsync(() => Task.FromResult(page.Url), value => value.Contains(expected, StringComparison.Ordinal), $"URL contains '{expected}'");
            case AssertionType.UrlNotIncludes:
                return await EventuallyStringAsync(() => Task.FromResult(page.Url), value => !value.Contains(expected, StringComparison.Ordinal), $"URL does not contain '{expected}'");
            case AssertionType.PathEquals:
                return Check(new Uri(page.Url).AbsolutePath, value => value == expected, expected);
            case AssertionType.PathIncludes:
                return Check(new Uri(page.Url).AbsolutePath, value => value.Contains(expected, StringComparison.Ordinal), $"path contains '{expected}'");
            case AssertionType.QueryStringEquals:
                return Check(new Uri(page.Url).Query.TrimStart('?'), value => value == expected.TrimStart('?'), expected);
            case AssertionType.QueryStringIncludes:
                return Check(new Uri(page.Url).Query, value => value.Contains(expected, StringComparison.Ordinal), $"query contains '{expected}'");
            case AssertionType.HashEquals:
                return Check(new Uri(page.Url).Fragment.TrimStart('#'), value => value == expected.TrimStart('#'), expected);
            case AssertionType.TitleEquals:
                return await EventuallyStringAsync(page.TitleAsync, value => value == expected, expected);
            case AssertionType.TitleIncludes:
                return await EventuallyStringAsync(page.TitleAsync, value => value.Contains(expected, StringComparison.Ordinal), $"title contains '{expected}'");

            case AssertionType.CookieExists:
            case AssertionType.CookieEquals:
            case AssertionType.CookieAbsent:
                return await AssertCookieAsync(context, assertion, expected);
            case AssertionType.LocalStorageExists:
                return Bool(await StorageAsync(page, "localStorage", RequiredName(assertion)) is not null, "localStorage key exists");
            case AssertionType.LocalStorageEquals:
                return Check(await StorageAsync(page, "localStorage", RequiredName(assertion)) ?? string.Empty, value => value == expected, expected);
            case AssertionType.LocalStorageAbsent:
                return Bool(await StorageAsync(page, "localStorage", RequiredName(assertion)) is null, "localStorage key absent");
            case AssertionType.SessionStorageExists:
                return Bool(await StorageAsync(page, "sessionStorage", RequiredName(assertion)) is not null, "sessionStorage key exists");
            case AssertionType.SessionStorageEquals:
                return Check(await StorageAsync(page, "sessionStorage", RequiredName(assertion)) ?? string.Empty, value => value == expected, expected);
            case AssertionType.SessionStorageAbsent:
                return Bool(await StorageAsync(page, "sessionStorage", RequiredName(assertion)) is null, "sessionStorage key absent");

            case AssertionType.RequestOccurred:
                return Bool(MatchingRequests(observation, assertion).Any(), "request occurred");
            case AssertionType.RequestNotOccurred:
                return Bool(!MatchingRequests(observation, assertion).Any(), "request did not occur");
            case AssertionType.RequestCountEquals:
                return Number(MatchingRequests(observation, assertion).Count(), value => value == expectedNumber, expectedNumber);
            case AssertionType.RequestMethodEquals:
                return Check(MatchingRequests(observation, assertion).LastOrDefault()?.Method ?? string.Empty, value => value == expected, expected);
            case AssertionType.RequestHeaderEquals:
                return AssertRequestHeader(MatchingRequests(observation, assertion).LastOrDefault(), assertion, expected);
            case AssertionType.RequestBodyEquals:
                return Check(MatchingRequests(observation, assertion).LastOrDefault()?.PostData ?? string.Empty, value => value == expected, expected);
            case AssertionType.RequestBodyContains:
                return Check(MatchingRequests(observation, assertion).LastOrDefault()?.PostData ?? string.Empty, value => value.Contains(expected, StringComparison.Ordinal), $"body contains '{expected}'");
            case AssertionType.RequestJsonPathEquals:
                return Check(JsonPath(MatchingRequests(observation, assertion).LastOrDefault()?.PostData, RequiredName(assertion)), value => value == expected, expected);
            case AssertionType.RequestDurationAtMost:
                return AssertNetworkDuration(observation, assertion, expectedNumber);

            case AssertionType.ResponseStatusEquals:
                return Number(RequiredResponse(observation, assertion).Status, value => value == expectedNumber, expectedNumber);
            case AssertionType.ResponseStatusInRange:
                return AssertResponseStatusRange(RequiredResponse(observation, assertion), assertion);
            case AssertionType.ResponseHeaderExists:
                return AssertResponseHeader(RequiredResponse(observation, assertion), assertion, expected, equals: false);
            case AssertionType.ResponseHeaderEquals:
                return AssertResponseHeader(RequiredResponse(observation, assertion), assertion, expected, equals: true);
            case AssertionType.ResponseBodyEquals:
            case AssertionType.ResponseBodyContains:
            case AssertionType.ResponseJsonPathEquals:
                return await AssertResponseBodyAsync(RequiredResponse(observation, assertion), assertion, expected);

            case AssertionType.NoAccessibilityViolations:
            case AssertionType.NoCriticalAccessibilityViolations:
            case AssertionType.MaximumAccessibilityViolations:
                return await AssertAccessibilityAsync(page, assertion, expectedNumber);

            case AssertionType.FileDownloaded:
                return Bool(observation.Downloads.Any(), "file downloaded");
            case AssertionType.FileNotDownloaded:
                return Bool(!observation.Downloads.Any(), "file not downloaded");
            case AssertionType.FileNameEquals:
                return Check(RequiredDownload(observation).SuggestedFilename, value => value == expected, expected);
            case AssertionType.FileNameContains:
                return Check(RequiredDownload(observation).SuggestedFilename, value => value.Contains(expected, StringComparison.Ordinal), $"filename contains '{expected}'");
            case AssertionType.FileExists:
            case AssertionType.FileSizeEquals:
            case AssertionType.FileSizeMinimum:
            case AssertionType.FileSizeMaximum:
            case AssertionType.FileContentEquals:
            case AssertionType.FileContentContains:
            case AssertionType.JsonFilePathEquals:
                return await AssertDownloadedFileAsync(RequiredDownload(observation), assertion, expected, expectedNumber, cancellationToken);

            case AssertionType.PageLoadAtMost:
                return Metric(await NavigationMetricAsync(page, "load"), Limit(assertion));
            case AssertionType.DomContentLoadedAtMost:
                return Metric(await NavigationMetricAsync(page, "dom"), Limit(assertion));
            case AssertionType.FirstByteAtMost:
                return Metric(await NavigationMetricAsync(page, "ttfb"), Limit(assertion));
            case AssertionType.TotalTransferSizeAtMost:
                return Metric(await NavigationMetricAsync(page, "transfer"), Limit(assertion));
            case AssertionType.ResourceLoadAtMost:
            case AssertionType.ApiResponseAtMost:
                return AssertObservedNetworkMetric(observation, assertion, Limit(assertion));
            case AssertionType.WebVitalAtMost:
                return Metric(await WebVitalAsync(page, RequiredName(assertion)), Limit(assertion));

            case AssertionType.NewWindowOpened:
                return Bool(context.Pages.Count > observation.InitialPageCount, "new window opened");
            case AssertionType.NewWindowNotOpened:
                return Bool(context.Pages.Count == observation.InitialPageCount, "no new window opened");
            case AssertionType.NewWindowCountEquals:
                return Number(context.Pages.Count - observation.InitialPageCount, value => value == expectedNumber, expectedNumber);
            case AssertionType.NewWindowUrlEquals:
                return Check(NewestPopup(context, observation).Url, value => value == expected, expected);
            case AssertionType.NewWindowUrlContains:
                return Check(NewestPopup(context, observation).Url, value => value.Contains(expected, StringComparison.Ordinal), $"popup URL contains '{expected}'");
            case AssertionType.NewWindowTitleEquals:
                return Check(await NewestPopup(context, observation).TitleAsync(), value => value == expected, expected);

            case AssertionType.NoConsoleErrors:
                return Number(observation.BrowserEvents.Count(value => value.Type == "Console" && string.Equals(value.Level, "error", StringComparison.OrdinalIgnoreCase)), value => value == 0, 0);
            case AssertionType.MaximumConsoleWarnings:
                return Number(observation.BrowserEvents.Count(value => value.Type == "Console" && string.Equals(value.Level, "warning", StringComparison.OrdinalIgnoreCase)), value => value <= expectedNumber, expectedNumber);
            case AssertionType.NoPageErrors:
                return Number(observation.BrowserEvents.Count(value => value.Type == "PageError"), value => value == 0, 0);
            case AssertionType.NoFailedRequests:
                return Number(observation.NetworkEvents.Count(value => value.Failed), value => value == 0, 0);
            case AssertionType.NoHttp500Responses:
                return Number(observation.NetworkEvents.Count(value => value.ResponseStatus is >= 500 and <= 599), value => value == 0, 0);
            default:
                throw new NotSupportedException($"Assertion '{assertion.Type}' is registered but has no Playwright implementation.");
        }
    }

    private static async Task<string> AssertCookieAsync(IBrowserContext context, AssertionDefinition assertion, string expected)
    {
        var cookie = (await context.CookiesAsync()).FirstOrDefault(value => value.Name == RequiredName(assertion));
        return assertion.Type switch
        {
            AssertionType.CookieExists => Bool(cookie is not null, "cookie exists"),
            AssertionType.CookieAbsent => Bool(cookie is null, "cookie absent"),
            _ => Check(cookie?.Value ?? string.Empty, value => value == expected, expected)
        };
    }

    private static string AssertRequestHeader(IRequest? request, AssertionDefinition assertion, string expected)
    {
        if (request is null) throw new InvalidOperationException("Matching request was not observed.");
        var name = RequiredName(assertion).ToLowerInvariant();
        request.Headers.TryGetValue(name, out var value);
        return Check(value ?? string.Empty, actual => actual == expected, expected);
    }

    private static string AssertNetworkDuration(PlaywrightObservation observation, AssertionDefinition assertion, int expectedNumber)
    {
        var durations = observation.NetworkEvents
            .Where(value => TargetMatch(value.Url, assertion.Target))
            .Select(value => value.DurationMs ?? 0)
            .ToArray();
        if (durations.Length == 0) throw new InvalidOperationException("Matching network request was not observed.");
        var actual = durations.Max();
        if (actual > expectedNumber) throw new InvalidOperationException($"Expected duration <= {expectedNumber}ms but observed {actual}ms.");
        return actual.ToString(CultureInfo.InvariantCulture);
    }

    private static string AssertResponseStatusRange(IResponse response, AssertionDefinition assertion)
    {
        var min = OptionInt(assertion, "min", 200);
        var max = OptionInt(assertion, "max", 299);
        if (response.Status < min || response.Status > max)
            throw new InvalidOperationException($"Expected response status between {min} and {max}, observed {response.Status}.");
        return response.Status.ToString(CultureInfo.InvariantCulture);
    }

    private static string AssertResponseHeader(IResponse response, AssertionDefinition assertion, string expected, bool equals)
    {
        var name = RequiredName(assertion).ToLowerInvariant();
        var exists = response.Headers.TryGetValue(name, out var value);
        if (!equals) return Bool(exists, $"response header '{name}' exists");
        return Check(exists ? value ?? string.Empty : string.Empty, actual => actual == expected, expected);
    }

    private static async Task<string> AssertResponseBodyAsync(IResponse response, AssertionDefinition assertion, string expected)
    {
        var body = await response.TextAsync();
        return assertion.Type switch
        {
            AssertionType.ResponseBodyEquals => Check(body, value => value == expected, expected),
            AssertionType.ResponseBodyContains => Check(body, value => value.Contains(expected, StringComparison.Ordinal), $"body contains '{expected}'"),
            _ => Check(JsonPath(body, RequiredName(assertion)), value => value == expected, expected)
        };
    }

    private static async Task<string> AssertAccessibilityAsync(IPage page, AssertionDefinition assertion, int expectedNumber)
    {
        var result = await page.RunAxe();
        var violations = result.Violations?.ToArray() ?? [];
        if (assertion.Type == AssertionType.NoAccessibilityViolations)
            return Number(violations.Length, value => value == 0, 0);
        if (assertion.Type == AssertionType.NoCriticalAccessibilityViolations)
        {
            var critical = violations.Count(value => string.Equals(value.Impact, "critical", StringComparison.OrdinalIgnoreCase));
            return Number(critical, value => value == 0, 0);
        }
        return Number(violations.Length, value => value <= expectedNumber, expectedNumber);
    }

    private static async Task<string> AssertDownloadedFileAsync(
        IDownload download,
        AssertionDefinition assertion,
        string expected,
        int expectedNumber,
        CancellationToken cancellationToken)
    {
        var path = await download.PathAsync();
        if (assertion.Type == AssertionType.FileExists) return Bool(File.Exists(path), "downloaded file exists");

        var info = new FileInfo(path);
        if (assertion.Type == AssertionType.FileSizeEquals) return LongNumber(info.Length, value => value == expectedNumber, expectedNumber);
        if (assertion.Type == AssertionType.FileSizeMinimum) return LongNumber(info.Length, value => value >= expectedNumber, expectedNumber);
        if (assertion.Type == AssertionType.FileSizeMaximum) return LongNumber(info.Length, value => value <= expectedNumber, expectedNumber);

        var contents = await File.ReadAllTextAsync(path, cancellationToken);
        return assertion.Type switch
        {
            AssertionType.FileContentEquals => Check(contents, value => value == expected, expected),
            AssertionType.FileContentContains => Check(contents, value => value.Contains(expected, StringComparison.Ordinal), $"file contains '{expected}'"),
            _ => Check(JsonPath(contents, RequiredName(assertion)), value => value == expected, expected)
        };
    }

    private static string AssertObservedNetworkMetric(PlaywrightObservation observation, AssertionDefinition assertion, double limit)
    {
        var matching = observation.NetworkEvents
            .Where(value => TargetMatch(value.Url, assertion.Target))
            .Select(value => (double)(value.DurationMs ?? 0))
            .ToArray();
        if (matching.Length == 0) throw new InvalidOperationException("Matching resource/API request was not observed.");
        return Metric(matching.Max(), limit);
    }

    private static IEnumerable<IRequest> MatchingRequests(PlaywrightObservation observation, AssertionDefinition assertion) =>
        observation.Requests.Where(value => TargetMatch(value.Url, assertion.Target));

    private static IResponse RequiredResponse(PlaywrightObservation observation, AssertionDefinition assertion) =>
        observation.Responses.LastOrDefault(value => TargetMatch(value.Url, assertion.Target))
        ?? throw new InvalidOperationException("Matching response was not observed.");

    private static IDownload RequiredDownload(PlaywrightObservation observation) =>
        observation.Downloads.LastOrDefault()
        ?? throw new InvalidOperationException("No downloaded file was observed.");

    private static IPage NewestPopup(IBrowserContext context, PlaywrightObservation observation)
    {
        if (context.Pages.Count <= observation.InitialPageCount)
            throw new InvalidOperationException("No new window or tab was observed.");
        return context.Pages[^1];
    }

    private static ILocator Required(ILocator? locator) =>
        locator ?? throw new InvalidOperationException("This assertion requires a locator.");

    private static string RequiredName(AssertionDefinition assertion) =>
        !string.IsNullOrWhiteSpace(assertion.Name)
            ? assertion.Name
            : throw new InvalidOperationException($"Assertion '{assertion.Type}' requires a name (attribute, property, storage key, JSON path, or metric name).");

    private static bool TokenContains(string? source, string token) =>
        (source ?? string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries).Contains(token, StringComparer.Ordinal);

    private static int OptionInt(AssertionDefinition assertion, string key, int fallback) =>
        assertion.Options is not null && assertion.Options.TryGetValue(key, out var value) && int.TryParse(value, out var parsed)
            ? parsed
            : fallback;

    private static int ParseInt(string value) => int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;

    private static double Limit(AssertionDefinition assertion)
    {
        if (assertion.ExpectedMetric.HasValue) return assertion.ExpectedMetric.Value;
        if (assertion.ExpectedNumber.HasValue) return assertion.ExpectedNumber.Value;
        if (double.TryParse(assertion.Expected, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)) return parsed;
        throw new InvalidOperationException($"Assertion '{assertion.Type}' requires a numeric limit.");
    }

    private static string Bool(bool passed, string expected)
    {
        if (!passed) throw new InvalidOperationException($"Expected condition: {expected}.");
        return "true";
    }

    private static string Check(string actual, Func<string, bool> predicate, string expected)
    {
        if (!predicate(actual)) throw new InvalidOperationException($"Expected {expected}; observed '{actual}'.");
        return actual;
    }

    private static string Number(int actual, Func<int, bool> predicate, int expected)
    {
        if (!predicate(actual)) throw new InvalidOperationException($"Expected numeric condition using {expected}; observed {actual}.");
        return actual.ToString(CultureInfo.InvariantCulture);
    }

    private static string LongNumber(long actual, Func<long, bool> predicate, long expected)
    {
        if (!predicate(actual)) throw new InvalidOperationException($"Expected numeric condition using {expected}; observed {actual}.");
        return actual.ToString(CultureInfo.InvariantCulture);
    }

    private static string Metric(double actual, double maximum)
    {
        if (actual > maximum) throw new InvalidOperationException($"Expected metric <= {maximum:0.##}; observed {actual:0.##}.");
        return actual.ToString("0.##", CultureInfo.InvariantCulture);
    }

    private static bool TargetMatch(string url, string? target) =>
        string.IsNullOrWhiteSpace(target) || url.Contains(target, StringComparison.OrdinalIgnoreCase);

    private static async Task<bool> EventuallyAsync(Func<Task<bool>> probe, int timeoutMs = DefaultRetryTimeoutMs)
    {
        var watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                if (await probe()) return true;
            }
            catch (PlaywrightException)
            {
                // Retry until timeout; final failure is surfaced by the caller.
            }
            await Task.Delay(100);
        }
        return false;
    }

    private static async Task<string> EventuallyStringAsync(
        Func<Task<string>> read,
        Func<string, bool> predicate,
        string expected,
        int timeoutMs = DefaultRetryTimeoutMs)
    {
        var watch = Stopwatch.StartNew();
        string actual = string.Empty;
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                actual = await read();
                if (predicate(actual)) return actual;
            }
            catch (PlaywrightException)
            {
            }
            await Task.Delay(100);
        }
        throw new InvalidOperationException($"Expected {expected}; observed '{actual}'.");
    }

    private static async Task<string?> EventuallyNullableStringAsync(
        Func<Task<string?>> read,
        Func<string?, bool> predicate,
        string expected,
        int timeoutMs = DefaultRetryTimeoutMs)
    {
        var watch = Stopwatch.StartNew();
        string? actual = null;
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            try
            {
                actual = await read();
                if (predicate(actual)) return actual;
            }
            catch (PlaywrightException)
            {
            }
            await Task.Delay(100);
        }
        throw new InvalidOperationException($"Expected {expected}; observed '{actual ?? "<null>"}'.");
    }

    private static async Task<string> EventuallyCountAsync(
        ILocator locator,
        Func<int, bool> predicate,
        int expected,
        int timeoutMs = DefaultRetryTimeoutMs)
    {
        var watch = Stopwatch.StartNew();
        var actual = 0;
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            actual = await locator.CountAsync();
            if (predicate(actual)) return actual.ToString(CultureInfo.InvariantCulture);
            await Task.Delay(100);
        }
        throw new InvalidOperationException($"Expected collection condition using {expected}; observed count {actual}.");
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
            if (current.ValueKind == JsonValueKind.Object && current.TryGetProperty(part, out var next))
            {
                current = next;
                continue;
            }
            return string.Empty;
        }
        return current.ValueKind == JsonValueKind.String ? current.GetString() ?? string.Empty : current.ToString();
    }

    private static Task<double> NavigationMetricAsync(IPage page, string metric) =>
        page.EvaluateAsync<double>(
            "metric => { const n=performance.getEntriesByType('navigation')[0]; if(!n) return 0; if(metric==='load') return n.loadEventEnd-n.startTime; if(metric==='dom') return n.domContentLoadedEventEnd-n.startTime; if(metric==='ttfb') return n.responseStart-n.requestStart; if(metric==='transfer') return n.transferSize||0; return 0; }",
            metric);

    private static Task<double> WebVitalAsync(IPage page, string metric) =>
        page.EvaluateAsync<double>(
            "metric => { metric=String(metric).toUpperCase(); const n=performance.getEntriesByType('navigation')[0]; if(metric==='TTFB') return n ? n.responseStart-n.requestStart : 0; if(metric==='FCP'){const e=performance.getEntriesByName('first-contentful-paint').at(-1);return e?e.startTime:0;} if(metric==='LCP'){const e=performance.getEntriesByType('largest-contentful-paint').at(-1);return e?e.startTime:0;} if(metric==='CLS') return performance.getEntriesByType('layout-shift').filter(x=>!x.hadRecentInput).reduce((s,x)=>s+x.value,0); return 0; }",
            metric);
}
