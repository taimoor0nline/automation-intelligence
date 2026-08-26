using AITestPilot.Domain.Testing;

namespace AITestPilot.Application.Testing;

public sealed record AssertionCapability(
    string Code,
    string Category,
    string Description,
    bool RequiresLocator,
    bool RequiresExpectedValue,
    bool RequiresName,
    bool RequiresTarget,
    bool SupportsOptions);

public sealed record UnsupportedCapabilitySuggestion(
    string SuggestedCode,
    string Reason,
    string RecommendedCategory);

public interface IAssertionCapabilityCatalog
{
    IReadOnlyCollection<AssertionCapability> GetAll();
    bool IsSupported(string code);
    AssertionCapability? Find(string code);
    UnsupportedCapabilitySuggestion Suggest(string requestedCapability, string? requirementContext = null);
}

public sealed class AssertionCapabilityCatalog : IAssertionCapabilityCatalog
{
    private static readonly IReadOnlyDictionary<string, AssertionCapability> Capabilities =
        Enum.GetValues<AssertionType>()
            .Select(Create)
            .ToDictionary(x => x.Code, StringComparer.OrdinalIgnoreCase);

    public IReadOnlyCollection<AssertionCapability> GetAll() => Capabilities.Values.OrderBy(x => x.Category).ThenBy(x => x.Code).ToArray();
    public bool IsSupported(string code) => Capabilities.ContainsKey(code);
    public AssertionCapability? Find(string code) => Capabilities.TryGetValue(code, out var capability) ? capability : null;

    public UnsupportedCapabilitySuggestion Suggest(string requestedCapability, string? requirementContext = null)
    {
        var normalized = ToCode(requestedCapability);
        var reason = string.IsNullOrWhiteSpace(requirementContext)
            ? $"'{requestedCapability}' is not currently registered as an executable assertion."
            : $"The requirement needs '{requestedCapability}', but the capability is not currently registered. Context: {requirementContext.Trim()}";
        return new UnsupportedCapabilitySuggestion(normalized, reason, InferCategory(requestedCapability));
    }

    private static AssertionCapability Create(AssertionType type)
    {
        var category = Category(type);
        var requiresLocator = category is "DOM / Visibility" or "Text / HTML" or "Forms" or "Attributes / UI State" or "Collections";
        var requiresTarget = category is "Network / API" || type is AssertionType.ResourceLoadAtMost or AssertionType.ApiResponseAtMost;
        var requiresName = type is
            AssertionType.AttributeExists or AssertionType.AttributeAbsent or AssertionType.AttributeEquals or AssertionType.AttributeContains or
            AssertionType.PropertyEquals or AssertionType.CssValueEquals or AssertionType.AriaValueEquals or
            AssertionType.CookieExists or AssertionType.CookieEquals or AssertionType.CookieAbsent or
            AssertionType.LocalStorageExists or AssertionType.LocalStorageEquals or AssertionType.LocalStorageAbsent or
            AssertionType.SessionStorageExists or AssertionType.SessionStorageEquals or AssertionType.SessionStorageAbsent or
            AssertionType.RequestHeaderEquals or AssertionType.RequestJsonPathEquals or
            AssertionType.ResponseHeaderExists or AssertionType.ResponseHeaderEquals or AssertionType.ResponseJsonPathEquals or
            AssertionType.JsonFilePathEquals or AssertionType.WebVitalAtMost;
        var requiresExpected = type is not (
            AssertionType.ElementExists or AssertionType.ElementNotExists or AssertionType.ElementVisible or AssertionType.ElementHidden or AssertionType.ElementHiddenOrAbsent or
            AssertionType.TextEmpty or AssertionType.TextNonEmpty or AssertionType.ValueEmpty or AssertionType.ValueNonEmpty or
            AssertionType.Checked or AssertionType.Unchecked or AssertionType.Enabled or AssertionType.Disabled or AssertionType.Focused or AssertionType.Required or AssertionType.Optional or
            AssertionType.Html5Valid or AssertionType.Html5Invalid or AssertionType.AttributeExists or AssertionType.AttributeAbsent or
            AssertionType.CookieExists or AssertionType.CookieAbsent or AssertionType.LocalStorageExists or AssertionType.LocalStorageAbsent or
            AssertionType.SessionStorageExists or AssertionType.SessionStorageAbsent or AssertionType.RequestOccurred or AssertionType.RequestNotOccurred or
            AssertionType.ResponseHeaderExists or AssertionType.NoAccessibilityViolations or AssertionType.NoCriticalAccessibilityViolations or
            AssertionType.FileDownloaded or AssertionType.FileNotDownloaded or AssertionType.FileExists or
            AssertionType.NewWindowOpened or AssertionType.NewWindowNotOpened or AssertionType.NoConsoleErrors or AssertionType.NoPageErrors or
            AssertionType.NoFailedRequests or AssertionType.NoHttp500Responses);

        return new AssertionCapability(
            Code(type),
            category,
            Description(type),
            requiresLocator,
            requiresExpected,
            requiresName,
            requiresTarget,
            type is AssertionType.ResponseStatusInRange);
    }

    private static string Code(AssertionType type) => ToCode(type.ToString());

    private static string ToCode(string value)
    {
        var chars = new List<char>(value.Length + 12);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (!char.IsLetterOrDigit(c))
            {
                if (chars.Count > 0 && chars[^1] != '_') chars.Add('_');
                continue;
            }
            if (char.IsUpper(c) && i > 0 && chars.Count > 0 && chars[^1] != '_' && char.IsLower(value[i - 1])) chars.Add('_');
            chars.Add(char.ToUpperInvariant(c));
        }
        return new string([.. chars]).Trim('_');
    }

    private static string Category(AssertionType type) => type switch
    {
        <= AssertionType.ElementHiddenOrAbsent => "DOM / Visibility",
        <= AssertionType.HtmlContains => "Text / HTML",
        <= AssertionType.SelectedValueEquals => "Forms",
        <= AssertionType.AccessibleDescriptionEquals => "Attributes / UI State",
        <= AssertionType.CountMaximum => "Collections",
        <= AssertionType.TitleIncludes => "Navigation / Document",
        <= AssertionType.SessionStorageAbsent => "Browser State",
        <= AssertionType.RequestDurationAtMost => "Network / API",
        <= AssertionType.MaximumAccessibilityViolations => "Accessibility",
        <= AssertionType.JsonFilePathEquals => "Downloads / Files",
        <= AssertionType.WebVitalAtMost => "Performance",
        <= AssertionType.NewWindowCountEquals => "Windows / Tabs",
        _ => "Browser Errors"
    };

    private static string Description(AssertionType type) => type.ToString();

    private static string InferCategory(string requested) => requested.ToLowerInvariant() switch
    {
        var x when x.Contains("pdf") || x.Contains("file") || x.Contains("download") => "Downloads / Files",
        var x when x.Contains("access") || x.Contains("wcag") || x.Contains("axe") => "Accessibility",
        var x when x.Contains("response") || x.Contains("request") || x.Contains("api") || x.Contains("network") => "Network / API",
        var x when x.Contains("performance") || x.Contains("vital") || x.Contains("load") => "Performance",
        var x when x.Contains("cookie") || x.Contains("storage") => "Browser State",
        _ => "Custom"
    };
}
