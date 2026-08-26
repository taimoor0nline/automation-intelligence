using System.Collections.Concurrent;
using AITestPilot.Application.Abstractions;
using Microsoft.Playwright;

namespace AITestPilot.Playwright;

internal sealed class PlaywrightObservation
{
    private readonly ConcurrentDictionary<IRequest, DateTimeOffset> _requestStarted = new();

    public ConcurrentBag<IRequest> Requests { get; } = [];
    public ConcurrentBag<IResponse> Responses { get; } = [];
    public ConcurrentBag<IDownload> Downloads { get; } = [];
    public ConcurrentBag<BrowserExecutionEvidence> BrowserEvents { get; } = [];
    public ConcurrentBag<NetworkExecutionEvidence> NetworkEvents { get; } = [];
    public int InitialPageCount { get; private set; }

    public void Attach(IPage page, IBrowserContext context)
    {
        InitialPageCount = context.Pages.Count;

        page.Console += (_, message) =>
            BrowserEvents.Add(new BrowserExecutionEvidence(
                DateTimeOffset.UtcNow,
                "Console",
                message.Type,
                message.Text,
                page.Url));

        page.PageError += (_, error) =>
            BrowserEvents.Add(new BrowserExecutionEvidence(
                DateTimeOffset.UtcNow,
                "PageError",
                "error",
                error,
                page.Url));

        page.Download += (_, download) =>
        {
            Downloads.Add(download);
            BrowserEvents.Add(new BrowserExecutionEvidence(
                DateTimeOffset.UtcNow,
                "Download",
                null,
                download.SuggestedFilename,
                page.Url));
        };

        context.Page += (_, popup) =>
            BrowserEvents.Add(new BrowserExecutionEvidence(
                DateTimeOffset.UtcNow,
                "Popup",
                null,
                "New page opened",
                popup.Url));

        page.Request += (_, request) =>
        {
            Requests.Add(request);
            _requestStarted[request] = DateTimeOffset.UtcNow;
        };

        page.Response += (_, response) =>
        {
            Responses.Add(response);
            var now = DateTimeOffset.UtcNow;
            var started = _requestStarted.TryGetValue(response.Request, out var timestamp)
                ? timestamp
                : now;

            NetworkEvents.Add(new NetworkExecutionEvidence(
                now,
                response.Url,
                response.Request.Method,
                response.Status,
                response.Request.ResourceType,
                false,
                null,
                Math.Max(0, (long)(now - started).TotalMilliseconds)));
        };

        page.RequestFailed += (_, request) =>
        {
            var now = DateTimeOffset.UtcNow;
            var started = _requestStarted.TryGetValue(request, out var timestamp)
                ? timestamp
                : now;

            NetworkEvents.Add(new NetworkExecutionEvidence(
                now,
                request.Url,
                request.Method,
                null,
                request.ResourceType,
                true,
                request.Failure,
                Math.Max(0, (long)(now - started).TotalMilliseconds)));
        };
    }
}
