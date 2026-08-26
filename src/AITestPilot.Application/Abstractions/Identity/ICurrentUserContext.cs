namespace AITestPilot.Application.Abstractions.Identity;

public interface ICurrentUserContext
{
    Guid UserId { get; }
    string? Email { get; }
    bool IsAuthenticated { get; }
}
