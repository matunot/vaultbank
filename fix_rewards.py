import re

with open('server/config/database.js', 'r') as f:
    lines = f.readlines()

# Find and replace lines 654-667 (the broken db.query block)
output_lines = []
i = 0
while i < len(lines):
    if i == 654:  # Line 655 in 1-indexed
        # Skip the old block (lines 655-667)
        i = 667
        # Write the fixed version
        output_lines.append('        await db.query(\n')
        output_lines.append("            'UPDATE rewards SET points = points + , lifetime_points = lifetime_points + , tier =  WHERE user_id = ',\n")
        output_lines.append('            [userId, points, reward.lifetime_points + points >= 10000 ? \'platinum\' : reward.lifetime_points + points >= 5000 ? \'gold\' : reward.lifetime_points + points >= 1000 ? \'silver\' : \'bronze\']\n')
        output_lines.append('        );\n')
        continue
    output_lines.append(lines[i])
    i += 1

with open('server/config/database.js', 'w') as f:
    f.writelines(output_lines)

print('Fixed!')
