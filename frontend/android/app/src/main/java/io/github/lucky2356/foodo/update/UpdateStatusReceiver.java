package io.github.lucky2356.foodo.update;

import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.os.Build;

/**
 * Result of the app's own PackageInstaller session (not exported; reached only through the
 * explicit PendingIntent created in FoodoUpdaterPlugin). On "pending user action" it opens
 * Android's install confirmation; other results are passed to the web UI.
 */
public class UpdateStatusReceiver extends BroadcastReceiver {

    static final String ACTION = "io.github.lucky2356.foodo.UPDATE_INSTALL_STATUS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || !ACTION.equals(intent.getAction())) {
            return;
        }
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
        switch (status) {
            case PackageInstaller.STATUS_PENDING_USER_ACTION:
                Intent confirm = confirmationIntent(intent);
                if (confirm == null) {
                    FoodoUpdaterPlugin.reportInstallStatus("failure", "No confirmation screen");
                    return;
                }
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    context.startActivity(confirm);
                    FoodoUpdaterPlugin.reportInstallStatus("pending", null);
                } catch (ActivityNotFoundException | SecurityException e) {
                    FoodoUpdaterPlugin.reportInstallStatus("failure", e.getMessage());
                }
                return;
            case PackageInstaller.STATUS_SUCCESS:
                // Usually not seen: Android stops the old version while replacing it.
                FoodoUpdaterPlugin.reportInstallStatus("success", null);
                return;
            case PackageInstaller.STATUS_FAILURE_ABORTED:
                FoodoUpdaterPlugin.reportInstallStatus("aborted", message);
                return;
            default:
                FoodoUpdaterPlugin.reportInstallStatus("failure", message);
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent confirmationIntent(Intent intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_INTENT);
    }
}
