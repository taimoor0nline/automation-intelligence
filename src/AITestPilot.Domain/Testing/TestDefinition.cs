namespace AITestPilot.Domain.Testing;

public enum TestAction
{
    Navigate,
    Click,
    Fill,
    Clear,
    Check,
    Uncheck,
    SelectOption,
    Press,
    Hover,
    Focus,
    UploadFile,
    Wait,
    Reload,
    GoBack,
    GoForward
}

public enum LocatorStrategy
{
    TestId,
    Role,
    Label,
    Placeholder,
    Text,
    Css,
    XPath,
    Id,
    Name,
    AriaLabel
}

public sealed record LocatorDefinition(
    LocatorStrategy Strategy,
    string Value,
    string? Role = null,
    bool Exact = true);

public sealed record TestStepDefinition(
    int Sequence,
    TestAction Action,
    string? Target = null,
    LocatorDefinition? Locator = null,
    string? Value = null,
    IReadOnlyDictionary<string, string>? Options = null);

public sealed record AssertionDefinition(
    int Sequence,
    AssertionType Type,
    LocatorDefinition? Locator = null,
    string? Expected = null,
    string? Name = null,
    string? Target = null,
    int? ExpectedNumber = null,
    double? ExpectedMetric = null,
    IReadOnlyDictionary<string, string>? Options = null);

public sealed record TestDefinition(
    int Version,
    IReadOnlyList<TestStepDefinition> Steps,
    IReadOnlyList<AssertionDefinition> Assertions);
