using AITestPilot.Domain.Testing;
using Microsoft.Playwright;

namespace AITestPilot.Playwright;

internal static class PlaywrightLocatorResolver
{
    public static ILocator Resolve(IPage page, LocatorDefinition locator) => locator.Strategy switch
    {
        LocatorStrategy.TestId => page.GetByTestId(locator.Value),
        LocatorStrategy.Label => page.GetByLabel(locator.Value, new PageGetByLabelOptions { Exact = locator.Exact }),
        LocatorStrategy.Placeholder => page.GetByPlaceholder(locator.Value, new PageGetByPlaceholderOptions { Exact = locator.Exact }),
        LocatorStrategy.Text => page.GetByText(locator.Value, new PageGetByTextOptions { Exact = locator.Exact }),
        LocatorStrategy.Role => page.GetByRole(ParseRole(locator.Role ?? locator.Value), new PageGetByRoleOptions
        {
            Name = locator.Role is null ? null : locator.Value,
            Exact = locator.Exact
        }),
        LocatorStrategy.Id => page.Locator($"#{CssEscape(locator.Value)}"),
        LocatorStrategy.Name => page.Locator($"[name=\"{AttributeEscape(locator.Value)}\"]"),
        LocatorStrategy.AriaLabel => page.Locator($"[aria-label=\"{AttributeEscape(locator.Value)}\"]"),
        LocatorStrategy.XPath => page.Locator($"xpath={locator.Value}"),
        _ => page.Locator(locator.Value)
    };

    private static AriaRole ParseRole(string role) =>
        Enum.TryParse<AriaRole>(role, true, out var parsed)
            ? parsed
            : throw new ArgumentException($"Unknown ARIA role '{role}'.", nameof(role));

    private static string CssEscape(string value) => value
        .Replace("\\", "\\\\", StringComparison.Ordinal)
        .Replace("\"", "\\\"", StringComparison.Ordinal);

    private static string AttributeEscape(string value) => value
        .Replace("\\", "\\\\", StringComparison.Ordinal)
        .Replace("\"", "\\\"", StringComparison.Ordinal);
}
