using AITestPilot.Domain.Testing;
using Microsoft.Playwright;

namespace AITestPilot.Playwright;

internal static class PlaywrightStepExecutor
{
    public static async Task ExecuteAsync(
        IPage page,
        string startingUrl,
        TestStepDefinition step,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var locator = step.Locator is null ? null : PlaywrightLocatorResolver.Resolve(page, step.Locator);

        switch (step.Action)
        {
            case TestAction.Navigate:
                var destination = ResolveDestination(startingUrl, step.Target);
                await page.GotoAsync(destination, new PageGotoOptions { WaitUntil = WaitUntilState.DOMContentLoaded });
                return;
            case TestAction.Click:
                await Required(locator).ClickAsync();
                return;
            case TestAction.Fill:
                await Required(locator).FillAsync(step.Value ?? string.Empty);
                return;
            case TestAction.Clear:
                await Required(locator).ClearAsync();
                return;
            case TestAction.Check:
                await Required(locator).CheckAsync();
                return;
            case TestAction.Uncheck:
                await Required(locator).UncheckAsync();
                return;
            case TestAction.SelectOption:
                await Required(locator).SelectOptionAsync(step.Value ?? string.Empty);
                return;
            case TestAction.Press:
                await Required(locator).PressAsync(step.Value ?? "Enter");
                return;
            case TestAction.Hover:
                await Required(locator).HoverAsync();
                return;
            case TestAction.Focus:
                await Required(locator).FocusAsync();
                return;
            case TestAction.UploadFile:
                await Required(locator).SetInputFilesAsync(
                    step.Value ?? throw new InvalidOperationException("Upload path is required."));
                return;
            case TestAction.Wait:
                var delay = int.TryParse(step.Value, out var ms) ? Math.Clamp(ms, 0, 30_000) : 500;
                await Task.Delay(delay, cancellationToken);
                return;
            case TestAction.Reload:
                await page.ReloadAsync();
                return;
            case TestAction.GoBack:
                await page.GoBackAsync();
                return;
            case TestAction.GoForward:
                await page.GoForwardAsync();
                return;
            default:
                throw new NotSupportedException($"Unsupported action {step.Action}.");
        }
    }

    private static ILocator Required(ILocator? locator) =>
        locator ?? throw new InvalidOperationException("This action requires a locator.");

    private static string ResolveDestination(string startingUrl, string? target)
    {
        if (string.IsNullOrWhiteSpace(target)) return startingUrl;
        if (Uri.TryCreate(target, UriKind.Absolute, out var absolute)) return absolute.ToString();
        return new Uri(new Uri(startingUrl), target).ToString();
    }
}
