using System.Diagnostics;
using AITestPilot.Application.Abstractions;
using Microsoft.Playwright;

namespace AITestPilot.Playwright;

public sealed class PlaywrightExecutionEngine : ITestExecutionEngine
{
    public async Task<TestExecutionResult> ExecuteAsync(
        TestExecutionRequest request,
        CancellationToken cancellationToken)
    {
        ValidateRequest(request);
        var runWatch = Stopwatch.StartNew();
        using var playwright = await Microsoft.Playwright.Playwright.CreateAsync();
        var browserType = BrowserType(playwright, request.Options.Browser);
        var browser = await browserType.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = request.Options.Headless,
            SlowMo = Math.Max(0, request.Options.SlowMoMs)
        });

        try
        {
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
                results.Count(value => value.Passed),
                results.Count(value => !value.Passed && !value.Skipped),
                results.Count(value => value.Skipped),
                runWatch.Elapsed,
                results);
        }
        finally
        {
            await browser.CloseAsync();
        }
    }

    private static async Task<TestCaseExecutionResult> ExecuteCaseAsync(
        IBrowser browser,
        TestExecutionRequest request,
        TestExecutionCase testCase,
        CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        var caseDirectory = CaseDirectory(request, testCase);
        Directory.CreateDirectory(caseDirectory);

        var videoDirectory = request.Options.CaptureVideo
            ? Path.Combine(caseDirectory, "video")
            : null;
        if (videoDirectory is not null) Directory.CreateDirectory(videoDirectory);

        var context = await browser.NewContextAsync(new BrowserNewContextOptions
        {
            BaseURL = request.StartingUrl,
            RecordVideoDir = videoDirectory
        });

        var tracePath = request.Options.CaptureTrace
            ? Path.Combine(caseDirectory, "trace.zip")
            : null;
        if (tracePath is not null)
        {
            await context.Tracing.StartAsync(new TracingStartOptions
            {
                Screenshots = true,
                Snapshots = true,
                Sources = true
            });
        }

        var page = await context.NewPageAsync();
        var video = page.Video;
        var observation = new PlaywrightObservation();
        observation.Attach(page, context);

        var assertionEvidence = new List<AssertionExecutionEvidence>();
        string? failureType = null;
        string? failureMessage = null;
        string? screenshotPath = null;
        string? videoPath = null;
        var passed = true;

        try
        {
            foreach (var step in testCase.Definition.Steps.OrderBy(value => value.Sequence))
            {
                cancellationToken.ThrowIfCancellationRequested();
                await PlaywrightStepExecutor.ExecuteAsync(page, request.StartingUrl, step, cancellationToken);
            }

            foreach (var assertion in testCase.Definition.Assertions.OrderBy(value => value.Sequence))
            {
                cancellationToken.ThrowIfCancellationRequested();
                var startedAt = DateTimeOffset.UtcNow;
                try
                {
                    var actual = await PlaywrightAssertionExecutor.ExecuteAsync(
                        page,
                        context,
                        assertion,
                        observation,
                        cancellationToken);

                    assertionEvidence.Add(new AssertionExecutionEvidence(
                        assertion.Sequence,
                        assertion.Type,
                        true,
                        assertion.Expected,
                        actual,
                        null,
                        startedAt,
                        DateTimeOffset.UtcNow));
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    passed = false;
                    assertionEvidence.Add(new AssertionExecutionEvidence(
                        assertion.Sequence,
                        assertion.Type,
                        false,
                        assertion.Expected,
                        null,
                        exception.Message,
                        startedAt,
                        DateTimeOffset.UtcNow));
                }
            }

            if (!passed)
            {
                failureType = "Assertion";
                failureMessage = assertionEvidence.FirstOrDefault(value => !value.Passed)?.FailureMessage;
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            passed = false;
            failureType = "Execution";
            failureMessage = exception.Message;
        }
        finally
        {
            if (!passed && request.Options.CaptureScreenshotOnFailure)
            {
                screenshotPath = Path.Combine(caseDirectory, "failure.png");
                try
                {
                    await page.ScreenshotAsync(new PageScreenshotOptions
                    {
                        Path = screenshotPath,
                        FullPage = true
                    });
                }
                catch (PlaywrightException)
                {
                    screenshotPath = null;
                }
            }

            if (tracePath is not null)
            {
                try
                {
                    await context.Tracing.StopAsync(new TracingStopOptions { Path = tracePath });
                }
                catch (PlaywrightException)
                {
                    tracePath = null;
                }
            }

            try
            {
                await context.CloseAsync();
            }
            finally
            {
                if (video is not null)
                {
                    try
                    {
                        videoPath = await video.PathAsync();
                    }
                    catch (PlaywrightException)
                    {
                        videoPath = null;
                    }
                }
            }
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
            assertionEvidence,
            observation.BrowserEvents.OrderBy(value => value.OccurredAtUtc).ToArray(),
            observation.NetworkEvents.OrderBy(value => value.OccurredAtUtc).ToArray(),
            screenshotPath,
            videoPath,
            tracePath);
    }

    private static IBrowserType BrowserType(IPlaywright playwright, string browser) =>
        browser.Trim().ToLowerInvariant() switch
        {
            "firefox" => playwright.Firefox,
            "webkit" => playwright.Webkit,
            "chromium" or "chrome" or "edge" => playwright.Chromium,
            _ => throw new ArgumentException($"Unsupported Playwright browser '{browser}'.", nameof(browser))
        };

    private static string CaseDirectory(TestExecutionRequest request, TestExecutionCase testCase)
    {
        var root = request.Options.ArtifactDirectory
            ?? Path.Combine(AppContext.BaseDirectory, "artifacts");
        var safeCaseNumber = string.Concat(testCase.TestCaseNumber.Select(value =>
            Path.GetInvalidFileNameChars().Contains(value) ? '_' : value));
        return Path.Combine(root, request.TestRunId.ToString("N"), safeCaseNumber);
    }

    private static void ValidateRequest(TestExecutionRequest request)
    {
        if (request.WorkspaceId == Guid.Empty) throw new ArgumentException("WorkspaceId is required.", nameof(request));
        if (request.ProjectId == Guid.Empty) throw new ArgumentException("ProjectId is required.", nameof(request));
        if (request.ProjectEnvironmentId == Guid.Empty) throw new ArgumentException("ProjectEnvironmentId is required.", nameof(request));
        if (request.TestRunId == Guid.Empty) throw new ArgumentException("TestRunId is required.", nameof(request));
        if (request.TestCases.Count == 0) throw new ArgumentException("At least one test case is required.", nameof(request));
        if (!Uri.TryCreate(request.StartingUrl, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            throw new ArgumentException("StartingUrl must be an absolute HTTP/HTTPS URL.", nameof(request));
        }
    }
}
