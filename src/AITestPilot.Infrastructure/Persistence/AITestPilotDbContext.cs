using System.Text.Json;
using AITestPilot.Application.Abstractions.Identity;
using AITestPilot.Domain.Auditing;
using AITestPilot.Domain.Common;
using AITestPilot.Domain.Identity;
using AITestPilot.Domain.Projects;
using AITestPilot.Domain.Testing;
using AITestPilot.Domain.Workspaces;
using AITestPilot.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace AITestPilot.Infrastructure.Persistence;

public sealed class AITestPilotDbContext : IdentityDbContext<ApplicationUser, IdentityRole<Guid>, Guid>
{
    private readonly ICurrentUserContext? _currentUser;

    public AITestPilotDbContext(DbContextOptions<AITestPilotDbContext> options, ICurrentUserContext? currentUser = null)
        : base(options) => _currentUser = currentUser;

    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<WorkspaceMembership> WorkspaceMemberships => Set<WorkspaceMembership>();
    public DbSet<ProjectCategory> ProjectCategories => Set<ProjectCategory>();
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectEnvironment> ProjectEnvironments => Set<ProjectEnvironment>();
    public DbSet<TestCase> TestCases => Set<TestCase>();
    public DbSet<TestRun> TestRuns => Set<TestRun>();
    public DbSet<TestResult> TestResults => Set<TestResult>();
    public DbSet<TestAssertionResult> TestAssertionResults => Set<TestAssertionResult>();
    public DbSet<TestNetworkEvent> TestNetworkEvents => Set<TestNetworkEvent>();
    public DbSet<TestBrowserEvent> TestBrowserEvents => Set<TestBrowserEvent>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        base.OnModelCreating(builder);

        builder.Entity<Workspace>().ToTable("workspaces");
        builder.Entity<WorkspaceMembership>().ToTable("workspace_memberships");
        builder.Entity<ProjectCategory>().ToTable("project_categories");
        builder.Entity<Project>().ToTable("projects");
        builder.Entity<ProjectEnvironment>().ToTable("project_environments");
        builder.Entity<TestCase>().ToTable("test_cases");
        builder.Entity<TestRun>().ToTable("test_runs");
        builder.Entity<TestResult>().ToTable("test_results");
        builder.Entity<TestAssertionResult>().ToTable("test_assertion_results");
        builder.Entity<TestNetworkEvent>().ToTable("test_network_events");
        builder.Entity<TestBrowserEvent>().ToTable("test_browser_events");
        builder.Entity<AuditEvent>().ToTable("audit_events");
        builder.Entity<ApplicationUser>().ToTable("users");
        builder.Entity<IdentityRole<Guid>>().ToTable("roles");
        builder.Entity<IdentityUserRole<Guid>>().ToTable("user_roles");
        builder.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims");
        builder.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins");
        builder.Entity<IdentityRoleClaim<Guid>>().ToTable("role_claims");
        builder.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens");

        builder.Entity<Workspace>().HasIndex(x => x.Code).IsUnique();
        builder.Entity<WorkspaceMembership>().HasIndex(x => new { x.WorkspaceId, x.UserId }).IsUnique();
        builder.Entity<ProjectCategory>().HasIndex(x => new { x.WorkspaceId, x.Code }).IsUnique();
        builder.Entity<Project>().HasIndex(x => new { x.WorkspaceId, x.Code }).IsUnique();
        builder.Entity<ProjectEnvironment>().HasIndex(x => new { x.WorkspaceId, x.ProjectId, x.Name }).IsUnique();
        builder.Entity<TestCase>().HasIndex(x => new { x.WorkspaceId, x.ProjectId, x.TestCaseNumber }).IsUnique();
        builder.Entity<TestRun>().HasIndex(x => new { x.WorkspaceId, x.ProjectId, x.RunNumber }).IsUnique();
        builder.Entity<TestResult>().HasIndex(x => new { x.WorkspaceId, x.TestRunId, x.TestCaseId });
        builder.Entity<TestAssertionResult>().HasIndex(x => new { x.WorkspaceId, x.TestRunId, x.TestCaseId, x.Sequence });
        builder.Entity<TestNetworkEvent>().HasIndex(x => new { x.WorkspaceId, x.TestRunId, x.OccurredAtUtc });
        builder.Entity<TestBrowserEvent>().HasIndex(x => new { x.WorkspaceId, x.TestRunId, x.OccurredAtUtc });
        builder.Entity<AuditEvent>().HasIndex(x => new { x.WorkspaceId, x.OccurredAtUtc });

        builder.Entity<TestCase>()
            .Property(x => x.Definition)
            .HasColumnType("jsonb")
            .HasConversion(
                value => JsonSerializer.Serialize(value, (JsonSerializerOptions?)null),
                value => JsonSerializer.Deserialize<TestDefinition>(value, (JsonSerializerOptions?)null) ?? new TestDefinition(1, [], []));

        foreach (var entityType in builder.Model.GetEntityTypes())
        {
            foreach (var property in entityType.GetProperties())
            {
                property.SetColumnName(ToSnakeCase(property.Name));
            }
        }
    }

    public override int SaveChanges(bool acceptAllChangesOnSuccess)
    {
        StampAuditing();
        return base.SaveChanges(acceptAllChangesOnSuccess);
    }

    public override Task<int> SaveChangesAsync(bool acceptAllChangesOnSuccess, CancellationToken cancellationToken = default)
    {
        StampAuditing();
        return base.SaveChangesAsync(acceptAllChangesOnSuccess, cancellationToken);
    }

    private void StampAuditing()
    {
        var now = DateTimeOffset.UtcNow;
        var userId = _currentUser is { IsAuthenticated: true } ? _currentUser.UserId : (Guid?)null;

        foreach (var entry in ChangeTracker.Entries<AuditableEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Property(nameof(AuditableEntity.CreatedAtUtc)).CurrentValue = now;
                entry.Property(nameof(AuditableEntity.CreatedByUserId)).CurrentValue = userId;
            }

            if (entry.State is EntityState.Added or EntityState.Modified)
            {
                entry.Property(nameof(AuditableEntity.UpdatedAtUtc)).CurrentValue = now;
                entry.Property(nameof(AuditableEntity.UpdatedByUserId)).CurrentValue = userId;
            }
        }
    }

    private static string ToSnakeCase(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        var chars = new List<char>(value.Length + 8);
        for (var i = 0; i < value.Length; i++)
        {
            var c = value[i];
            if (char.IsUpper(c) && i > 0) chars.Add('_');
            chars.Add(char.ToLowerInvariant(c));
        }
        return new string([.. chars]);
    }
}
