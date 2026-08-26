using AITestPilot.Domain.Projects;
using AITestPilot.Domain.Workspaces;
using AITestPilot.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AITestPilot.Infrastructure.Community;

public static class CommunityDatabaseInitializer
{
    public static async Task InitializeAsync(
        IServiceProvider services,
        CancellationToken cancellationToken = default)
    {
        await using var scope = services.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<AITestPilotDbContext>();

        var migrations = await dbContext.Database.GetMigrationsAsync(cancellationToken);
        if (migrations.Any())
            await dbContext.Database.MigrateAsync(cancellationToken);
        else
            await dbContext.Database.EnsureCreatedAsync(cancellationToken);

        if (!await dbContext.Workspaces.AnyAsync(
                value => value.Id == CommunityDefaults.LocalWorkspaceId,
                cancellationToken))
        {
            await dbContext.Workspaces.AddAsync(
                new Workspace(
                    CommunityDefaults.LocalWorkspaceId,
                    CommunityDefaults.LocalWorkspaceCode,
                    CommunityDefaults.LocalWorkspaceName),
                cancellationToken);
        }

        if (!await dbContext.ProjectCategories.AnyAsync(
                value => value.WorkspaceId == CommunityDefaults.LocalWorkspaceId,
                cancellationToken))
        {
            var categories = new[]
            {
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "WEB", "Web Application", "Browser-based application", 10),
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "API", "API / Backend Service", "REST, HTTP, or backend service", 20),
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "PORTAL", "Enterprise Portal", "Enterprise or employee portal", 30),
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "ECOM", "E-Commerce", "E-commerce application", 40),
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "FIN", "Banking / Financial Application", "Banking, payments, or financial application", 50),
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "INTERNAL", "Internal Business Application", "Internal line-of-business application", 60),
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "PUBLIC", "Public Website", "Public-facing website", 70),
                new ProjectCategory(CommunityDefaults.LocalWorkspaceId, "OTHER", "Other", "Custom project category", 999)
            };
            await dbContext.ProjectCategories.AddRangeAsync(categories, cancellationToken);
        }

        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
